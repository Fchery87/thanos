// src/index.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

import { AuditLogger } from "../audit/logger";
import { PermissionManager } from "../permissions/manager";
import { gateDisabledByEnv, yoloDisabledByEnv } from "../permissions/yolo-config";
import { SpecEngine } from "../spec/engine";
import { buildContinuationPrompt, shouldReinject } from "../spec/gate";
import { GoalController } from "../goal/controller";
import { registerGoalCommand, renderGoalStatusSegment } from "../goal/command";
import { handleAgentEnd as handleGoalAgentEnd } from "../goal/loop";
import { readAborted, readWillRetry } from "../goal/extract";
import { loadGoalSettings } from "../goal/load-settings";
import { resolveGoalSettings } from "../goal/types";
import { serializeGoal } from "../goal/persist";
import { clearGoalState, saveGoalState } from "../goal/store";
import { makeAfterToolHandler } from "../hooks/after-tool";
import type { TaskParams } from "../agents/task-tool";
import { loadPolicyState } from "../policy/state";
import { registerSlashCommands } from "../commands/slash";
import { MCPManager } from "../mcp/manager";
import {
  DEFAULT_PICKER_LABEL_WIDTH,
  fitTerminalText,
  formatSpecForApproval,
  formatPanel,
  noopTheme,
} from "../ui-utils";
// Model router removed — use /models command or pi-subagents for model selection
import { createSnapshot } from "../security/snapshot";
// registerSearchTool removed — superseded by npm:pi-web-access
import type { ReviewFinding } from "../review/findings";
import { LensLite, registerLensLiteCommand } from "../lens/lite";
import { appendHarnessEvent } from "../observability/harness-ledger";
import { detectChildRole, isSubagentProcess } from "../agents/child-role";
import { roleNarrowingOverlay } from "../governance/role-overlay";
import { GovernanceRuntime } from "./governance-runtime";
import { issueContinuation } from "./continuation-auth";
import { registerThinkingCommand } from "./commands/thinking";
import { registerModelEvents } from "./model-events";
import { registerModesCommand } from "./commands/modes";
import { registerTodoCommand, registerTodoTool, TodoRuntime } from "./commands/todo";
import { registerDesignerCommand } from "./commands/designer";
import { registerMemoryCommands } from "./commands/memory";
import { registerYoloCommand, registerYoloShortcut } from "./commands/yolo";
import { DeliveryRuntime, registerDeliveryCommand } from "./commands/delivery";
import { registerShipCommand } from "./commands/ship";
import { registerMcpCommand } from "./commands/mcp";
import { registerModelsCommand } from "./commands/models";
import { registerDiagnosticShortcuts } from "./shortcuts";
import { registerGoalCompleteTool, registerAskTool, registerReportFindingTool } from "./tools";
import { registerSessionStart } from "./session-start";
import { registerBeforeAgentStart } from "./before-agent-start";


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


export function registerHarness(pi: ExtensionAPI, deps?: { initialYolo?: boolean }) {
  // PI_SUBAGENT_CHILD is set by the pi-subagents engine for every child it
  // spawns. Without checking it, children get the parent-only delegation
  // directive and recursively re-delegate (a reviewer spawning a reviewer)
  // instead of doing their own work, idling until their budget kills them.
  // See src/agents/child-role.ts for the PI_SUBAGENT_CHILD* env contract —
  // the sole subagent-detection signal (no legacy fallback).
  const isSubagent = isSubagentProcess(process.env);
  // Precise live-roster role name (e.g. "reviewer-security", "explore"),
  // undefined in the parent session (PI_SUBAGENT_CHILD_AGENT is only ever set
  // on a spawned child). Drives roleNarrowingOverlay below — undefined
  // naturally yields no narrowing, which is exactly right for a parent
  // session.
  const childRole = detectChildRole(process.env);
  const sessionId = crypto.randomUUID();
  const agentType = isSubagent ? "subagent" : "parent" as const;
  let defaultTaskType: TaskParams["type"] | undefined;
  const todoRuntime = new TodoRuntime();
  let reviewFindings: ReviewFinding[] = [];
  const lens = new LensLite(sessionId);

  const permissions = new PermissionManager();
  if (deps?.initialYolo !== undefined) {
    permissions.setYolo(deps.initialYolo);
  }
  if (yoloDisabledByEnv()) permissions.lockYolo();
  const spec = new SpecEngine();
  const goalSettings = resolveGoalSettings(loadGoalSettings());
  const goalController = new GoalController(goalSettings);
  const policyStatePromise = loadPolicyState(process.cwd(), process.env.HARNESS_POLICY_FILE);
  // Resolved in BOTH parent and child processes. A subagent's cwd is a worktree
  // of the same repo (shared git remote), so it matches the same registry entry —
  // giving children the same delivery overlay (e.g. local-only push-deny) AND the
  // repo's autonomy. This is what lets unattended repos run headless subagents
  // while attended/unregistered repos correctly fail closed (writer subagents
  // stall with no UI rather than auto-acting). resolveDeliveryState is fail-safe
  // (never throws).
  // CAVEAT: the registry match is by git REMOTE. A registry entry keyed only by
  // `path` (no `match`/remote), or a repo with no `origin`, won't match for a
  // subagent (its cwd is the worktree path), so it falls back to the safe default
  // (local-only/attended) — fail-safe, but path-only entries don't propagate to
  // subagents.
  // See DeliveryRuntime's constructor docblock for the subagent-remote-match
  // caveat and why resolution happens in both parent and child processes.
  const deliveryRuntime = new DeliveryRuntime(process.cwd());

  // ── MCP server management (main session only) ───────────────────────
  const mcpManager = isSubagent ? null : new MCPManager();

  registerSessionStart(pi, {
    todoRuntime,
    mcpManager,
    deliveryRuntime,
    permissions,
    lens,
    policyStatePromise,
    getDefaultTaskType: () => defaultTaskType,
    clearReviewFindings: () => { reviewFindings = []; },
    goalController,
    goalSettings,
  });

  // ── --spec flag ────────────────────────────────────────────────────
  pi.registerFlag("spec", {
    type: "boolean",
    default: false,
    description: "Require approval before first edit/exec when task is ambient",
  });

  registerModesCommand(pi, {
    getDefaultTaskType: () => defaultTaskType,
    setDefaultTaskType: (type) => { defaultTaskType = type; },
  });

  registerTodoCommand(pi, todoRuntime);

  // ── /remember + /memory — hand-curated project preferences ────────
  // Parent sessions only, so a subagent can never plant a memory.
  if (!isSubagent) {
    registerMemoryCommands(pi);
  }

  // ── /yolo — bypass all permission checks ──────────────────────────
  registerYoloCommand(pi, { permissions, getDeliveryState: () => deliveryRuntime.getState() });

  // ── /delivery — choose this project's delivery mode (persisted) ──

  registerDeliveryCommand(pi, { isSubagent, runtime: deliveryRuntime, permissions });

  // ── /ship — deliver the current branch per the resolved delivery mode ──
  registerShipCommand(pi, { isSubagent, runtime: deliveryRuntime });

  // ── /mcp — MCP server lifecycle management ───────────────────────
  registerMcpCommand(pi, { isSubagent, mcpManager });

  // ── Thinking level selector (command + ctrl+shift+k shortcut) ──────
  registerThinkingCommand(pi);

  // ── Model-lifecycle hooks: auto-prompt thinking level on model switch,
  // keep status bar in sync with Shift+Tab cycles ────────────────────
  registerModelEvents(pi);

  // ── /models — two-step provider→model selector ───────────────────
  registerModelsCommand(pi);

  // ── /goal command (self-checking autonomous loop) ──────────────────
  // Persists across transitions so a goal survives a session restart.
  // serializeGoal() already returns undefined for BOTH an achieved goal and
  // a cleared controller, so syncGoalStateToDisk needs no type-string
  // branching: something to persist → save it, nothing → clear the file.
  // Restored on session_start (parent-only) below.
  const syncGoalStateToDisk = async () => {
    const repo = process.cwd();
    const payload = serializeGoal(goalController);
    if (payload) {
      await saveGoalState(repo, { ...payload, repo }).catch((err) => {
        console.error("[harness][goal]", "failed to persist goal state:", err instanceof Error ? err.message : String(err));
      });
    } else {
      await clearGoalState(repo);
    }
  };
  const recordGoalEvent = async (event: { type: "goal_set" | "goal_achieved" | "goal_paused"; summary: string; outcome: string }) => {
    await appendHarnessEvent({ ...event, taskId: sessionId, createdAt: new Date().toISOString() }).catch((err) => {
      console.error("[harness][goal]", err instanceof Error ? err.message : String(err));
    });
    await syncGoalStateToDisk();
  };
  registerGoalCommand(pi, {
    controller: goalController,
    isSubagent,
    syncState: syncGoalStateToDisk,
    sendFollowUp: async (text) => { pi.sendUserMessage(text, { deliverAs: "followUp" }); },
    recordEvent: recordGoalEvent,
  });

  // ── goal_complete tool: agent-signaled completion, evaluator-confirmed ──
  // The agent calls this when it believes the active /goal is done. A fresh,
  // tool-less checker (the same evaluator, routed via the subagents toggle,
  // else the session model) confirms against the last turn's evidence before
  // the goal closes. On MET the loop terminates; on NOT_MET the agent keeps
  // working. Crucially, a checker ERROR never pauses the goal — it fails safe
  // to NOT_MET — so the per-turn "eval-error pause" class is gone entirely.
  if (!isSubagent) {
    registerGoalCompleteTool(pi, { goalController, goalSettings, recordGoalEvent });
  }

  // ── Slash commands ─────────────────────────────────────────────────
  registerSlashCommands(pi, {
    permissions,
    spec,
    policyPromise: policyStatePromise,
    getDefaultTaskType: () => defaultTaskType,
  });
  registerLensLiteCommand(pi, lens);

  // ── Keyboard shortcuts (appear in /hotkeys → Extensions) ───────────
  registerDiagnosticShortcuts(pi, {
    isSubagent,
    policyStatePromise,
    spec,
    permissions,
    getDefaultTaskType: () => defaultTaskType,
  });

  registerDesignerCommand(pi, isSubagent);

  registerYoloShortcut(pi, permissions);

  // ── Spec classification + session reset on each prompt ─────────────
  registerBeforeAgentStart(pi, { sessionId, isSubagent, permissions, spec, lens, goalController });

  // ── Governed execution gate: GovernanceRuntime.authorize() owns
  // policy construction, egress, push guard, permission evaluation,
  // yolo rules, audit recording, and snapshot decisions.
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

  // ── Web search tool ────────────────────────────────────────────────
  // registerSearchTool removed — superseded by npm:pi-web-access

  if (!isSubagent) {
    // THANOS_LEGACY_TASK was the gate for the dormant Thanos `task` tool
    // (superseded by pi-subagents `subagent` engine). It has been removed
    // as of the Phenomenal Harness program; use subagent delegation instead.
    if (process.env.THANOS_LEGACY_TASK === "1") {
      console.warn(
        "[harness] THANOS_LEGACY_TASK=1 is no longer supported. " +
        "The legacy `task` tool has been removed. Use the `subagent` tool from pi-subagents for delegation."
      );
    }

    registerTodoTool(pi, todoRuntime);
    registerAskTool(pi, policyStatePromise);
  }

  // Registered for every subagent process, not just reviewer roles: several
  // live roster agents (reviewer, reviewer-correctness, reviewer-security,
  // reviewer-tests, evaluator) list report_finding in their frontmatter tool
  // set, and per-agent exposure is already governed by that list (pi-subagents
  // filters registered tools down to it) — narrowing the registration itself
  // to one legacy-only role left every live one calling a tool that was never
  // registered in their process.
  if (isSubagent) {
    registerReportFindingTool(pi, {
      getReviewFindings: () => reviewFindings,
      setReviewFindings: (findings) => { reviewFindings = findings; },
    });
  }
}
