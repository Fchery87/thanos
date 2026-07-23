// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { PermissionManager } from "../permissions/manager";
import { yoloDisabledByEnv } from "../permissions/yolo-config";
import { SpecEngine } from "../spec/engine";
import { GoalController } from "../goal/controller";
import { registerGoalCommand } from "../goal/command";
import { loadGoalSettings } from "../goal/load-settings";
import { resolveGoalSettings } from "../goal/types";
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
import { registerModesCommand } from "./commands/modes";
import { registerTodoCommand, registerTodoTool, TodoRuntime } from "./commands/todo";
import { registerMemoryCommands } from "./commands/memory";
import { registerYoloCommand, registerYoloShortcut } from "./commands/yolo";
import { registerDeliveryCommand, DeliveryRuntime } from "./commands/delivery";
import { registerShipCommand } from "./commands/ship";
import { registerMcpCommand } from "./commands/mcp";
import { registerModelsCommand } from "./commands/models";
import { registerDesignerCommand } from "./commands/designer";
import { registerDiagnosticShortcuts } from "./shortcuts";
import { registerSessionStart } from "./session-start";
import { registerBeforeAgentStart } from "./before-agent-start";
import { registerGovernanceHooks } from "./governance-hooks";
import { registerModelEvents } from "./model-events";
import { registerGoalCompleteTool, registerAskTool, registerReportFindingTool } from "./tools";


export function registerHarness(pi: ExtensionAPI, deps?: { initialYolo?: boolean }) {
  // PI_SUBAGENT_CHILD is set by the pi-subagents engine for every child it
  // spawns. Without checking it, children get the parent-only delegation
  // directive and recursively re-delegate (a reviewer spawning a reviewer)
  // instead of doing their own work, idling until their budget kills them.
  // See src/agents/child-role.ts for the full legacy vs. live env contract.
  const isSubagent = isSubagentProcess(process.env);
  // Precise live-roster role name (e.g. "reviewer-security", "explore"),
  // undefined in the parent session and for the legacy path's generic "1"
  // marker. Drives roleNarrowingOverlay below — undefined naturally yields no
  // narrowing, which is exactly right for a parent session.
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
  const recordGoalEvent = (event: { type: "goal_set" | "goal_achieved" | "goal_paused"; summary: string; outcome: string }) =>
    appendHarnessEvent({ ...event, taskId: sessionId, createdAt: new Date().toISOString() }).catch((err) => {
      console.error("[harness][goal]", err instanceof Error ? err.message : String(err));
    });
  registerGoalCommand(pi, {
    controller: goalController,
    isSubagent,
    sendFollowUp: async (text) => { pi.sendUserMessage(text, { deliverAs: "followUp" }); },
    recordEvent: recordGoalEvent,
  });

  // ── goal_complete tool: agent-signaled completion, evaluator-confirmed ──
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
  // ctrl+shift+k (select thinking level) is registered by
  // registerThinkingCommand above, alongside the /thinking command it mirrors.

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

  // Subagent-only: see registerReportFindingTool's docblock for why this is
  // registered for every subagent process, not just reviewer roles.
  if (isSubagent) {
    registerReportFindingTool(pi, {
      getReviewFindings: () => reviewFindings,
      setReviewFindings: (findings) => { reviewFindings = findings; },
    });
  }

}
