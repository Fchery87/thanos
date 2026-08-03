// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { PermissionManager } from "../permissions/manager";
import { yoloDisabledByEnv } from "../permissions/yolo-config";
import { SpecEngine } from "../spec/engine";
import { ContractExtractor, loadSpecSettings } from "../spec/extractor";
import { createLedgerExtractionReporter } from "../spec/extraction-log";
import { GoalController } from "../goal/controller";
import { registerGoalCommand } from "../goal/command";
import { loadGoalSettings } from "../goal/load-settings";
import { resolveGoalSettings } from "../goal/types";
import { serializeGoal } from "../goal/persist";
import { clearGoalState, saveGoalState } from "../goal/store";
import { loadPolicyState } from "../policy/state";
import { registerSlashCommands } from "../commands/slash";
import { MCPManager } from "../mcp/manager";
// Model router removed — use /models command or pi-subagents for model selection
// registerSearchTool removed — superseded by npm:pi-web-access
import type { ReviewFinding } from "../review/findings";
import { LensLite, registerLensLiteCommand } from "../lens/lite";
import { appendHarnessEvent, createOrderedHarnessRecorder } from "../observability/harness-ledger";
import { detectChildRole, isSubagentProcess } from "../agents/child-role";
import { registerThinkingCommand } from "./commands/thinking";
import { registerModelEvents } from "./model-events";
import { registerTodoCommand, registerTodoTool, TodoRuntime } from "./commands/todo";
import { registerDesignerCommand } from "./commands/designer";
import { registerMemoryCommands } from "./commands/memory";
import { registerYoloCommand, registerYoloShortcut } from "./commands/yolo";
import { DeliveryRuntime, registerDeliveryCommand } from "./commands/delivery";
import { registerShipCommand } from "./commands/ship";
import { registerMcpCommand } from "./commands/mcp";
import { registerDoctorCommand } from "./commands/doctor";
import { registerModelsCommand } from "./commands/models";
import { registerDiagnosticShortcuts } from "./shortcuts";
import { registerGoalCompleteTool, registerAskTool, registerReportFindingTool } from "./tools";
import { registerSessionStart } from "./session-start";
import { registerBeforeAgentStart } from "./before-agent-start";
import { registerGovernanceHooks } from "./governance-hooks";
import { snapshotWorkingTree } from "../spec/diff-evidence";
import { issueContinuation } from "./continuation-auth";
import { WorkflowRuntime, WORKFLOW_JOURNAL_ENTRY } from "../workflows/state";
import { registerWorkflowYieldTool } from "../workflows/tool";
import { registerWorkflowSessionGuards } from "../workflows/session-control";


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
  // on a spawned child). Passed to registerGovernanceHooks, where it drives
  // roleNarrowingOverlay — undefined naturally yields no narrowing, which is
  // exactly right for a parent session.
  const childRole = detectChildRole(process.env);
  const sessionId = crypto.randomUUID();
  const agentType = isSubagent ? "subagent" : "parent" as const;
  const todoRuntime = new TodoRuntime();
  const recordWorkflowLifecycle = createOrderedHarnessRecorder();
  const workflowRuntime = new WorkflowRuntime({
    append: (snapshot) => pi.appendEntry(WORKFLOW_JOURNAL_ENTRY, snapshot),
    recordLifecycle: (event) => {
      if (isSubagent) return;
      void recordWorkflowLifecycle({
        type: "waves_lifecycle",
        taskId: sessionId,
        summary: `Waves ${event.from ? `${event.from} → ` : ""}${event.to}`,
        outcome: event.to,
        createdAt: new Date().toISOString(),
      }).catch((error) => {
        console.error("[harness][waves]", error instanceof Error ? error.message : String(error));
      });
    },
  });
  let reviewFindings: ReviewFinding[] = [];
  const lens = new LensLite(sessionId);

  const permissions = new PermissionManager();
  if (deps?.initialYolo !== undefined) {
    permissions.setYolo(deps.initialYolo);
  }
  if (yoloDisabledByEnv()) permissions.lockYolo();
  // Semantic contract extraction. The extractor holds no context at construction
  // — before_agent_start hands it the live one each turn. Every failure path
  // returns undefined, leaving the deterministic contract standing.
  //
  // Both halves report to the same ledger reporter: the extractor owns the paths
  // before a candidate exists (no model, no auth, timeout, unparseable), the
  // engine owns the ones after (schema rejection, empty objective, stale,
  // accepted). Fail-safe is unchanged; it is merely no longer silent. Subagents
  // are excluded — their turns are not the measurement, and a fan-out would
  // otherwise write one row per child.
  const extractionReporter = isSubagent ? undefined : createLedgerExtractionReporter(sessionId);
  const contractExtractor = new ContractExtractor(loadSpecSettings(), extractionReporter);
  const spec = new SpecEngine((prompt, tier) => contractExtractor.extract(prompt, tier), extractionReporter);
  const goalSettings = resolveGoalSettings(loadGoalSettings());
  const goalController = new GoalController(goalSettings);
  const policyStatePromise = loadPolicyState(process.cwd(), process.env.HARNESS_POLICY_FILE);
  // Resolved in BOTH parent and child processes — see DeliveryRuntime's
  // constructor docblock for why, plus the subagent-remote-match caveat
  // (path-only registry entries don't propagate to a subagent's worktree cwd).
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
    clearReviewFindings: () => { reviewFindings = []; },
    goalController,
    goalSettings,
    workflowRuntime,
  });
  if (!isSubagent) registerWorkflowSessionGuards(pi, workflowRuntime);

  // ── --spec flag ────────────────────────────────────────────────────
  pi.registerFlag("spec", {
    type: "boolean",
    default: false,
    description: "Require approval before first edit/exec when task is ambient",
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

  // ── /doctor — one read of everything that can drift silently ──────
  registerDoctorCommand(pi, {
    isSubagent, policyStatePromise, mcpManager, deliveryRuntime,
    goalController, spec, workflowRuntime,
  });

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
    authorizeFollowUp: (text, condition) => {
      // The Goal Intent becomes the one explicit Work Contract for the run.
      // The generated continuation is authorized so before_agent_start keeps
      // this contract and baseline instead of replacing it with the directive.
      spec.startTurn(condition, true);
      spec.turnBaseline = snapshotWorkingTree(process.cwd()).catch(() => undefined);
      issueContinuation(sessionId, "goal", text);
    },
    recordEvent: recordGoalEvent,
  });

  // ── goal_complete tool: agent-signaled claim, SpecEngine-decided at agent_end ──
  if (!isSubagent) {
    registerGoalCompleteTool(pi, { goalController });
    registerWorkflowYieldTool(pi, { runtime: workflowRuntime });
  }

  // ── Slash commands ─────────────────────────────────────────────────
  registerSlashCommands(pi, {
    permissions,
    spec,
    policyPromise: policyStatePromise,
    isSubagent,
    sessionId,
    workflowRuntime,
    getGoal: () => goalController.snapshot(),
    isGoalActive: () => goalController.isActive(),
  });
  registerLensLiteCommand(pi, lens);

  // ── Keyboard shortcuts (appear in /hotkeys → Extensions) ───────────
  registerDiagnosticShortcuts(pi, {
    isSubagent,
    policyStatePromise,
    spec,
    permissions,
    isGoalActive: () => goalController.isActive(),
  });

  registerDesignerCommand(pi, isSubagent);

  registerYoloShortcut(pi, permissions);

  // ── Spec classification + session reset on each prompt ─────────────
  registerBeforeAgentStart(pi, { sessionId, isSubagent, permissions, spec, lens, goalController, contractExtractor });

  // ── Governed execution gate: tool_call (GovernanceRuntime.authorize()),
  // tool_result (spec output collection), agent_end (spec verification gate
  // + the /goal loop's per-turn advance) ───────────────────────────────
  registerGovernanceHooks(pi, {
    policyStatePromise,
    deliveryRuntime,
    childRole,
    spec,
    permissions,
    sessionId,
    agentType,
    lens,
    isSubagent,
    goalController,
    recordGoalEvent,
    workflowRuntime,
  });

  // ── Web search tool ────────────────────────────────────────────────
  // registerSearchTool removed — superseded by npm:pi-web-access

  if (!isSubagent) {
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
