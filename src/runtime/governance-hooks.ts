import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AuditLogger } from "../audit/logger";
import type { PermissionManager } from "../permissions/manager";
import { gateDisabledByEnv } from "../permissions/yolo-config";
import type { SpecEngine } from "../spec/engine";
import { buildContinuationPrompt, shouldReinject } from "../spec/gate";
import type { GoalController } from "../goal/controller";
import { renderGoalStatusSegment } from "../goal/command";
import { handleAgentEnd as handleGoalAgentEnd, type GoalEventRecord } from "../goal/loop";
import { readAborted, readWillRetry } from "../goal/extract";
import { makeAfterToolHandler } from "../hooks/after-tool";
import type { LensLite } from "../lens/lite";
import { appendHarnessEvent } from "../observability/harness-ledger";
import { roleNarrowingOverlay } from "../governance/role-overlay";
import { GovernanceRuntime } from "./governance-runtime";
import { createSnapshot } from "../security/snapshot";
import { issueContinuation } from "./continuation-auth";
import { formatSpecForApproval, formatPanel, noopTheme } from "../ui-utils";
import type { DeliveryRuntime } from "./commands/delivery";
import type { PolicyLoadState } from "../policy/state";

const CTX_EXEC_TOOLS = new Set(["ctx_execute", "ctx_execute_file", "ctx_batch_execute"]);
const CTX_EXEC_MAX_TIMEOUT_MS = 110_000;

function contextModeExecutionGuard(event: { toolName?: string; input?: unknown }): { block: true; reason: string } | undefined {
  const toolName = event.toolName ?? "";
  if (!CTX_EXEC_TOOLS.has(toolName)) return undefined;

  const input = event.input && typeof event.input === "object" ? event.input as Record<string, unknown> : {};
  const timeout = Number(input.timeout);
  const hasTimeout = input.timeout !== undefined && Number.isFinite(timeout) && timeout > 0;

  if (!hasTimeout) {
    return {
      block: true,
      reason:
        `${toolName} was called without an explicit timeout. Context-mode's Pi bridge has a hard 120s tools/call ceiling; unbounded calls can freeze and fail with ` +
        `"MCP request timeout after 120000ms". Retry with a timeout <= ${CTX_EXEC_MAX_TIMEOUT_MS}ms. Suggested defaults: 10000ms for quick inspection, 30000ms for searches, 60000-90000ms for tests/builds. For servers/daemons, use background:true with a short timeout.`,
    };
  }

  if (timeout > CTX_EXEC_MAX_TIMEOUT_MS) {
    return {
      block: true,
      reason:
        `${toolName} timeout ${timeout}ms exceeds the safe Pi bridge budget. Retry with timeout <= ${CTX_EXEC_MAX_TIMEOUT_MS}ms, or use background:true with a short timeout for long-running processes.`,
    };
  }

  return undefined;
}

export interface GovernanceHooksDeps {
  policyStatePromise: Promise<PolicyLoadState>;
  deliveryRuntime: DeliveryRuntime;
  childRole: string | undefined;
  spec: SpecEngine;
  permissions: PermissionManager;
  sessionId: string;
  agentType: "parent" | "subagent";
  lens: LensLite;
  isSubagent: boolean;
  goalController: GoalController;
  recordGoalEvent: (event: GoalEventRecord) => Promise<void>;
}

/**
 * The three tool-lifecycle/turn-lifecycle hooks that make up the governed
 * execution gate: tool_call (GovernanceRuntime.authorize() owns policy
 * construction, egress, push guard, permission evaluation, yolo rules, audit
 * recording, and snapshot decisions), tool_result (spec output collection),
 * and agent_end (spec verification gate + the /goal loop's per-turn advance).
 */
export function registerGovernanceHooks(pi: ExtensionAPI, deps: GovernanceHooksDeps): void {
  const {
    policyStatePromise, deliveryRuntime, childRole, spec, permissions,
    sessionId, agentType, lens, isSubagent, goalController, recordGoalEvent,
  } = deps;

  pi.on("tool_call", async (event, ctx: ExtensionContext) => {
    const policyState = await policyStatePromise;
    if (policyState.kind === "error") {
      return { block: true, reason: `Policy configuration error: ${policyState.error}` };
    }

    const overlay = [...roleNarrowingOverlay(childRole), ...(await deliveryRuntime.getOverlay())];
    const effectivePolicy = overlay.length
      ? { ...policyState.policy, rules: [...overlay, ...policyState.policy.rules] }
      : policyState.policy;

    const delivery = await deliveryRuntime.getState();

    // Explicit-spec approval gate: fires before governance runtime
    const active = spec.activeSpec;
    if (active?.approvalStatus === "pending") {
      if (!ctx.hasUI) {
        return { block: true, reason: "Explicit spec needs approval but no UI available" };
      }
      const approved = await ctx.ui.confirm(
        "Spec Approval Required",
        formatSpecForApproval(active, ctx.ui.theme ?? noopTheme),
      );
      if (approved) {
        active.approvalStatus = "approved";
      } else {
        active.approvalStatus = "rejected";
        permissions.remember("*", "*", "deny");
        return { block: true, reason: `User rejected spec: ${active.goal}` };
      }
    }

    // An approved explicit spec narrows the session to its allowed capabilities.
    // (A pending spec is handled by the approval gate above; a rejected one has
    // already remembered a global deny.) The scope is enforced inside authorize.
    const specScope =
      active?.tier === "explicit" ? active.allowedCapabilities : undefined;

    const gov = new GovernanceRuntime({
      policy: effectivePolicy,
      permissions,
      yolo: permissions.isYolo,
      autonomy: delivery?.autonomy ?? "attended",
      deliveryMode: delivery?.mode,
      childRole,
      specScope,
      hasUI: ctx.hasUI,
      sessionId,
      agentType,
      recordAudit: async (e) => {
        const auditLogger = effectivePolicy.audit.enabled
          ? new AuditLogger(effectivePolicy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl"))
          : undefined;
        return auditLogger?.record(e);
      },
      promptUser: (msg: string) => ctx.ui.confirm("Permission Required", msg),
    });

    const decision = await gov.authorize(event.toolName, event.input);
    if (decision.block) {
      return { block: true, reason: decision.reason ?? "governance block" };
    }

    // Post-governance checks: context mode guard and LensLite
    const ctxGuardResult = contextModeExecutionGuard(event);
    if (ctxGuardResult?.block) return ctxGuardResult;

    const lensResult = await lens.beforeTool(event, ctx);
    if (lensResult?.block) return lensResult;

    // Snapshot for critical operations (governance signaled the need). This
    // runs under yolo too: authorize() sets snapshotNeeded for critical ops even
    // when yolo is on, preserving the pre-critical rollback point when prompts
    // are bypassed.
    if (decision.snapshotNeeded) {
      await createSnapshot(process.cwd());
    }
  });

  // ── Spec output collection ─────────────────────────────────────────
  pi.on("tool_result", (event, ctx: ExtensionContext) => {
    return policyStatePromise.then((state) => {
      lens.afterTool(event, ctx);
      const auditLogger = state.kind === "ok" && state.policy.audit.enabled
        ? new AuditLogger(state.policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl"))
        : undefined;
      return makeAfterToolHandler(spec, auditLogger, { sessionId, agentType })(event);
    }).catch((err) => {
      console.error("[harness][tool_result]", err instanceof Error ? err.message : String(err));
      return undefined;
    });
  });

  pi.on("agent_end", async (event, ctx: ExtensionContext) => {
    // ESC must win over both continuation drivers below: an aborted turn ends
    // with a final assistant message whose stopReason is "aborted".
    const turnAborted = readAborted(event);
    const results = spec.finishTurn(event.messages, { aborted: turnAborted });
    if (results.length > 0) {
      const theme = ctx.ui.theme ?? noopTheme;
      const passed = results.filter((r) => r.passed).length;
      const lines = results.map((r) => `  ${r.passed ? theme.fg("success", "✓") : theme.fg("error", "✗")}  ${r.criterion.statement}`);
      const approvalNote =
        spec.activeSpec?.approvalStatus === "rejected"
          ? `\n${theme.fg("dim", "(spec was rejected)")}`
          : "";
      const hasFailures = passed !== results.length;
      const summaryHeader = !ctx.hasUI && hasFailures
        ? `${theme.bold(theme.fg("error", "Spec failed:"))}${approvalNote}`
        : `${theme.bold("Spec:")} ${theme.fg(hasFailures ? "warning" : "success", `${passed}/${results.length}`)} passed${approvalNote}`;

      const panel = formatPanel(theme, hasFailures ? "Spec Verification Failed" : "Spec Verification", lines, hasFailures ? "error" : "success");
      ctx.ui.notify(
        `${summaryHeader}\n${panel}`,
        hasFailures ? "warning" : "info",
      );

      // The gate defers to an active /goal (goalActive) so the two loops never
      // both queue a follow-up in the same turn — the goal evaluator is the
      // sole continuation driver while a goal is active.
      if (shouldReinject({
        results,
        attempts: spec.gateAttempts,
        isSubagent,
        enabled: !gateDisabledByEnv(),
        goalActive: goalController.isActive(),
        aborted: turnAborted,
      })) {
        const prompt = buildContinuationPrompt(results, spec.gateAttempts);
        const failedCriteria = results.filter((result) => !result.passed).map((result) => result.criterion.statement);
        await appendHarnessEvent({
          type: "gate_failure",
          taskId: sessionId,
          model: ctx.model?.id,
          summary: `verification gate re-injected ${failedCriteria.length} unmet criteria`,
          evidence: failedCriteria,
          outcome: "needs_work",
          createdAt: new Date().toISOString(),
        }).catch((err) => {
          console.error("[harness][evolution]", err instanceof Error ? err.message : String(err));
        });
        spec.recordGateAttempt();
        issueContinuation(sessionId, "spec", prompt);
        await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      }
    }

    // ── /goal loop ─────────────────────────────────────────────────────
    // Runs regardless of spec state. It is a no-op unless a goal is active,
    // and the gate above already deferred to it, so at most one follow-up is
    // queued per turn. The evaluator no longer runs here — completion is
    // signaled by the goal_complete tool (which confirms via the evaluator);
    // a work turn only advances the counter and re-prompts or pauses.
    await handleGoalAgentEnd({
      controller: goalController,
      sendDirective: async (directive) => { pi.sendUserMessage(directive, { deliverAs: "followUp" }); },
      issueContinuation: (directive) => { issueContinuation(sessionId, "goal", directive); },
      notify: (message, level) => ctx.ui.notify(message, level ?? "info"),
      recordEvent: recordGoalEvent,
      getTokens: () => ctx.getContextUsage()?.tokens ?? 0,
      isSubagent,
    }, { willRetry: readWillRetry(event), aborted: turnAborted });
    ctx.ui.setStatus("harness-goal", renderGoalStatusSegment(goalController.snapshot()));
  });
}
