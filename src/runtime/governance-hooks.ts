import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
import { AuditLogger } from "../audit/logger";
import type { PermissionManager } from "../permissions/manager";
import { gateDisabledByEnv } from "../permissions/yolo-config";
import type { SpecEngine } from "../spec/engine";
import { buildContinuationPrompt, gatedFailures, shouldReinject } from "../spec/gate";
import { collectTurnDiffEvidence, snapshotWorkingTree } from "../spec/diff-evidence";
import type { GoalController } from "../goal/controller";
import { renderGoalStatusSegment } from "../goal/command";
import { decideCompletionClaim } from "../goal/completion";
import { buildContinueDirective as buildGoalContinueDirective } from "../goal/prompts";
import { handleAgentEnd as handleGoalAgentEnd, type GoalEventRecord } from "../goal/loop";
import { readAborted, readTerminalFailure, readWillRetry } from "../goal/extract";
import { makeAfterToolHandler } from "../hooks/after-tool";
import type { LensLite } from "../lens/lite";
import { appendHarnessEvent } from "../observability/harness-ledger";
import { GovernanceRuntime } from "./governance-runtime";
import { createSnapshot } from "../security/snapshot";
import { issueContinuation } from "./continuation-auth";
import { formatPanel, noopTheme, renderCriteriaLines } from "../ui-utils";
import type { DeliveryRuntime } from "./commands/delivery";
import type { PolicyLoadState } from "../policy/state";
import { approvePendingWorkContract } from "./work-contract-approval";
import { handleWorkflowAgentEnd, type WorkflowAgentEndResult } from "../workflows/agent-end";
import { captureRepositoryRevisionIdentity } from "../workflows/revision";
import { runJuryWorkflow } from "../workflows/runtime";
import {
  workflowAllowsGoalCompletion,
  type WorkflowRuntime,
  type WorkflowSnapshot,
} from "../workflows/state";

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
  workflowRuntime: WorkflowRuntime;
}

function workflowOwnsContinuation(snapshot: WorkflowSnapshot | undefined): boolean {
  if (!snapshot || snapshot.phase === "completed" || snapshot.phase === "cancelled" || snapshot.phase === "handed_off") {
    return false;
  }
  return snapshot.phase !== "paused" || snapshot.mode === "standalone";
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
    workflowRuntime,
  } = deps;

  pi.on("tool_call", async (event, ctx: ExtensionContext) => {
    const policyState = await policyStatePromise;
    if (policyState.kind === "error") {
      return { block: true, reason: `Policy configuration error: ${policyState.error}` };
    }

    const delivery = await deliveryRuntime.getState();

    // Explicit-spec approval gate: fires before governance runtime
    const active = spec.activeSpec;
    if (active?.approvalStatus === "pending") {
      const approval = await approvePendingWorkContract(spec, {
        repoDir: process.cwd(),
        runId: sessionId,
        hasUI: ctx.hasUI,
        theme: ctx.ui.theme ?? noopTheme,
        confirm: (title, message) => ctx.ui.confirm(title, message),
      });
      if (!approval.approved) {
        const reason = (approval as { approved: false; reason: string }).reason;
        if (reason.startsWith("user rejected")) {
          // Turn-scoped stop; rejectActiveSpec() already made the refusal
          // terminal for the task itself.
          permissions.remember("*", "*", "deny");
        }
        return { block: true, reason };
      }
    }

    // An approved explicit spec narrows the session to its allowed capabilities.
    // (A pending spec is handled by the approval gate above; a rejected one has
    // already remembered a global deny.) The scope is enforced inside authorize.
    const specScope =
      active?.tier === "explicit" ? active.allowedCapabilities : undefined;

    const gov = new GovernanceRuntime({
      policy: policyState.policy,
      permissions,
      yolo: permissions.isYolo,
      autonomy: delivery?.autonomy ?? "attended",
      deliveryMode: delivery?.mode,
      childRole,
      specScope,
      workContract: active?.tier === "explicit" && active.approvalStatus === "approved"
        ? {
            repoDir: process.cwd(),
            revision: spec.workContractRevision ?? "",
            runGrant: spec.runGrant,
          }
        : undefined,
      hasUI: ctx.hasUI,
      sessionId,
      agentType,
      recordAudit: async (e) => {
        const auditLogger = policyState.policy.audit.enabled
          ? new AuditLogger(policyState.policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl"))
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
    return policyStatePromise.then(async (state) => {
      lens.afterTool(event, ctx);
      const auditLogger = state.kind === "ok" && state.policy.audit.enabled
        ? new AuditLogger(state.policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl"))
        : undefined;
      const override = await makeAfterToolHandler(spec, auditLogger, { sessionId, agentType })(event);
      if (!override) return undefined;
      // makeAfterToolHandler's ToolResultOverride uses a deliberately loose
      // content-part shape (spec/evidence.ts's TextPart, `{ type: string; text?:
      // string }`) so tests can build fake events without importing the real
      // SDK content union. Its actual values are always either passed through
      // unchanged from the real event.content, or a shallow copy of a text part
      // with only `text` rewritten (see truncateContextToolResult) — i.e.
      // always a genuine TextContent | ImageContent at runtime. This cast
      // reconciles that at the one boundary where it must satisfy pi's real
      // ToolResultEventResult contract.
      return {
        content: override.content as (TextContent | ImageContent)[] | undefined,
        details: override.details,
        isError: override.isError,
      };
    }).catch((err) => {
      console.error("[harness][tool_result]", err instanceof Error ? err.message : String(err));
      return undefined;
    });
  });

  pi.on("agent_end", async (event, ctx: ExtensionContext) => {
    // ESC must win over both continuation drivers below: an aborted turn ends
    // with a final assistant message whose stopReason is "aborted".
    const turnAborted = readAborted(event);

    // Ground truth before verifying: what the working tree says changed, not what
    // the edit/write tool arguments claimed. Only replaces the intent-based
    // records when git actually answered — outside a repo the tool-input diffs
    // stand. Never allowed to throw: a verification detail must not fail the turn.
    if (spec.activeSpec) {
      try {
        // Fold in any semantic contract before verifying against it. No-op when no
        // extractor is wired, and when one is, the turn's own work has already
        // hidden the latency.
        await spec.settleContract();
        const baseline = await spec.turnBaseline;
        const groundTruth = await collectTurnDiffEvidence(process.cwd(), baseline);
        if (groundTruth) spec.replaceDiffEvidence(groundTruth);
      } catch (err) {
        console.error("[harness][diff-evidence]", err instanceof Error ? err.message : String(err));
      }
    }

    const completionClaim = goalController.takeCompletionClaim();
    let workflowResult: WorkflowAgentEndResult = { owned: false, state: "inactive" };
    if (!isSubagent && workflowOwnsContinuation(workflowRuntime.current)) {
      workflowResult = await handleWorkflowAgentEnd({
        runtime: workflowRuntime,
        cwd: ctx.cwd,
        sendContinuation: async (directive) => {
          issueContinuation(sessionId, "waves", directive);
          await pi.sendUserMessage(directive, { deliverAs: "followUp" });
        },
        runJury: () => runJuryWorkflow(pi, ctx, ctx.signal),
        captureRevision: captureRepositoryRevisionIdentity,
        recordWorkflowEvidence: (references, verdict) => {
          const snapshot = workflowRuntime.current;
          const active = snapshot?.phase === "paused" ? snapshot.resume : snapshot;
          if (active && "plan" in active) {
            spec.recordWorkflowEvidenceRefs(active.plan, references, verdict);
          }
        },
        verify: () => spec.verify(),
      }, {
        aborted: turnAborted,
        willRetry: readWillRetry(event),
        terminalFailure: readTerminalFailure(event),
        goalClaimed: completionClaim !== undefined,
      });
    }
    const wavesOwnsTurn = workflowResult.owned;
    if (
      workflowResult.owned
      && workflowResult.state === "paused"
      && workflowRuntime.current?.phase === "paused"
      && workflowRuntime.current.mode === "goal_attached"
    ) {
      const goal = goalController.snapshot();
      if (goal?.status === "active") {
        const directive = buildGoalContinueDirective();
        spec.startTurn(goal.condition, true);
        spec.turnBaseline = snapshotWorkingTree(process.cwd()).catch(() => undefined);
        issueContinuation(sessionId, "goal", directive);
        await pi.sendUserMessage(directive, { deliverAs: "followUp" });
      }
    }

    // Abort is not consulted here: verification is a pure read of collected
    // evidence. Whether an aborted turn may continue is the gate's decision, and
    // shouldReinject takes `aborted` directly.
    const results = spec.verify();
    if (results.length > 0) {
      const theme = ctx.ui.theme ?? noopTheme;
      const passed = results.filter((r) => r.passed).length;
      const lines = renderCriteriaLines(theme, results);
      // (A "(spec was rejected)" note used to hang here. A rejected spec is now
      // dropped at the approval gate, so finishTurn returns no results and this
      // whole block is skipped — the note had become unreachable.)
      // "Failed" must mean the gate will act. An unmet advisory criterion is
      // reported in the lines above but is not a failure of this turn.
      const blocking = gatedFailures(results);
      const hasFailures = blocking.length > 0;
      const summaryHeader = !ctx.hasUI && hasFailures
        ? `${theme.bold(theme.fg("error", "Spec failed:"))}`
        : `${theme.bold("Spec:")} ${theme.fg(hasFailures ? "warning" : "success", `${passed}/${results.length}`)} passed`;

      const goalActive = goalController.isActive();
      const panel = formatPanel(
        theme,
        goalActive
          ? (hasFailures ? "Spec Verification (goal active)" : "Spec Verification (goal active)")
          : (hasFailures ? "Spec Verification Failed" : "Spec Verification"),
        lines,
        goalActive ? "warning" : (hasFailures ? "error" : "success"),
      );
      const notification = goalActive && hasFailures
        ? "info"
        : hasFailures
          ? "warning"
          : "info";
      const header = goalActive && hasFailures
        ? `${theme.bold("Spec:")} ${theme.fg("dim", `${passed}/${results.length}`)} checked while /goal is active`
        : summaryHeader;
      ctx.ui.notify(
        `${header}\n${panel}`,
        notification,
      );

      // The gate defers to an active /goal (goalActive) so the two loops never
      // both queue a follow-up in the same turn — the Goal Loop is the sole
      // continuation driver while a goal is active.
      if (shouldReinject({
        results,
        attempts: spec.gateAttempts,
        isSubagent,
        enabled: !gateDisabledByEnv(),
        goalActive: goalActive || wavesOwnsTurn,
        aborted: turnAborted,
        specApproved: spec.activeSpec?.approvalStatus !== "rejected",
      })) {
        const prompt = buildContinuationPrompt(results, spec.gateAttempts);
        // Exactly what the continuation prompt asked for. Deriving this from a raw
        // !passed filter made the ledger claim advisory criteria had been
        // re-injected when the prompt had excluded them — and this event feeds the
        // eval bench and generated model profiles.
        const failedCriteria = blocking.map((result) => result.criterion.statement);
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

    // A goal_complete call is only a claim. Decide it here, after SpecEngine
    // settled the contract and collected repository evidence. This is the one
    // operator-task acceptance path; the claim cannot terminate a turn itself.
    if (completionClaim !== undefined) {
      const verdict = workflowAllowsGoalCompletion(workflowRuntime.current)
        ? decideCompletionClaim(completionClaim, results, {
            contractApproved: spec.activeSpec?.approvalStatus === "approved",
          })
        : {
            met: false,
            reason: "Goal-Attached Waves has not reached fresh jury-approved acceptance",
          };
      const action = goalController.confirmComplete(verdict);
      if (action.kind === "achieved") {
        if (workflowRuntime.current?.phase === "awaiting_acceptance"
          && workflowRuntime.current.mode === "goal_attached") {
          workflowRuntime.complete("SpecEngine accepted the Goal-Attached Waves Work Contract");
        }
        await recordGoalEvent({ type: "goal_achieved", summary: action.reason, outcome: `turns=${action.turns}` });
        ctx.ui.notify(`◎ /goal achieved in ${action.turns} turns — ${action.reason}`, "info");
      } else if (action.kind === "rejected") {
        ctx.ui.notify(`◎ completion claim rejected — ${action.reason}`, "warning");
        if (workflowRuntime.current?.phase === "awaiting_acceptance"
          && workflowRuntime.current.mode === "goal_attached") {
          const next = workflowRuntime.reopenIntegration("integration_turn_budget_exhausted");
          if (next.phase === "integrating") {
            const directive = buildContinuationPrompt(results, next.integrationTurns);
            issueContinuation(sessionId, "waves", directive);
            await pi.sendUserMessage(directive, { deliverAs: "followUp" });
          }
        }
      }
    } else if (workflowResult.owned && workflowResult.state === "awaiting_goal_claim") {
      issueContinuation(sessionId, "waves", workflowResult.directive);
      await pi.sendUserMessage(workflowResult.directive, { deliverAs: "followUp" });
    }

    // ── /goal loop ─────────────────────────────────────────────────────
    // Runs regardless of spec state. It is a no-op unless a goal is active,
    // and the gate above already deferred to it, so at most one follow-up is
    // queued per turn. The evaluator no longer runs here — completion is
    // signaled by the goal_complete tool and decided above by SpecEngine; a
    // work turn only advances the counter and re-prompts or pauses.
    if (!wavesOwnsTurn) {
      await handleGoalAgentEnd({
        controller: goalController,
        sendDirective: async (directive) => { pi.sendUserMessage(directive, { deliverAs: "followUp" }); },
        issueContinuation: (directive) => { issueContinuation(sessionId, "goal", directive); },
        notify: (message, level) => ctx.ui.notify(message, level ?? "info"),
        recordEvent: recordGoalEvent,
        getTokens: () => ctx.getContextUsage()?.tokens ?? 0,
        isSubagent,
      }, { willRetry: readWillRetry(event), aborted: turnAborted });
    }
    ctx.ui.setStatus("harness-goal", renderGoalStatusSegment(goalController.snapshot()));
  });
}
