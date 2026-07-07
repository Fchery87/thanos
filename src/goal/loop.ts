import type { GoalController } from "./controller";

export interface AgentEndInfo {
  willRetry: boolean;
}

export interface GoalEventRecord {
  type: "goal_set" | "goal_achieved" | "goal_paused";
  summary: string;
  outcome: string;
}

export interface LoopDeps {
  controller: GoalController;
  sendDirective: (directive: string) => Promise<void>;
  notify: (message: string, level?: "info" | "warning") => void;
  recordEvent: (event: GoalEventRecord) => Promise<void>;
  getTokens: () => number;
  isSubagent: boolean;
}

/**
 * Per-turn driver for an active goal. It no longer runs the evaluator: since
 * completion is signaled by the agent via the goal_complete tool (which
 * confirms through the evaluator), a work turn only advances the counters and
 * either re-prompts the agent to continue or pauses on a ceiling. Achievement
 * happens in the tool, so by the time that turn ends the goal is no longer
 * active and this returns early.
 */
export async function handleAgentEnd(deps: LoopDeps, info: AgentEndInfo): Promise<void> {
  const { controller } = deps;
  const snap = controller.snapshot();
  if (deps.isSubagent || info.willRetry || !snap || snap.status !== "active") return;

  const action = controller.onTurnEnd(deps.getTokens());
  switch (action.kind) {
    case "continue":
      await deps.sendDirective(action.directive);
      break;
    case "paused":
      deps.notify(`◎ /goal paused — ${action.detail} Run /goal resume to continue.`, "warning");
      await deps.recordEvent({ type: "goal_paused", summary: action.detail, outcome: action.why });
      break;
    default:
      break;
  }
}
