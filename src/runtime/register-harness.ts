// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { PermissionManager } from "../permissions/manager";
import { yoloDisabledByEnv } from "../permissions/yolo-config";
import { SpecEngine } from "../spec/engine";
import { ContractExtractor } from "../spec/extractor";
import { GoalController } from "../goal/controller";
import { registerGoalCommand } from "../goal/command";
import { loadGoalSettings } from "../goal/load-settings";
import { resolveGoalSettings } from "../goal/types";
import { serializeGoal } from "../goal/persist";
import { clearGoalState, saveGoalState } from "../goal/store";
import type { TaskParams } from "../agents/task-tool";
import { loadPolicyState } from "../policy/state";
import { registerSlashCommands } from "../commands/slash";
import { MCPManager } from "../mcp/manager";
// Model router removed — use /models command or pi-subagents for model selection
// registerSearchTool removed — superseded by npm:pi-web-access
import type { ReviewFinding } from "../review/findings";
import { LensLite, registerLensLiteCommand } from "../lens/lite";
import { appendHarnessEvent } from "../observability/harness-ledger";
import { detectChildRole, isSubagentProcess } from "../agents/child-role";
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
import { registerGovernanceHooks } from "./governance-hooks";


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
  let defaultTaskType: TaskParams["type"] | undefined;
  const todoRuntime = new TodoRuntime();
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
  const contractExtractor = new ContractExtractor();
  const spec = new SpecEngine((prompt, tier) => contractExtractor.extract(prompt, tier));
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
