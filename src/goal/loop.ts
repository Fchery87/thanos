import type { GoalController } from "./controller";

export interface AgentEndInfo {
  willRetry: boolean;
  /** True when the user aborted the turn (ESC) — pause instead of continuing. */
  aborted: boolean;
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
  issueContinuation?: (directive: string) => void;
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

  // ESC must win: pause the goal (recoverable via /goal resume) without
  // consuming a turn — the aborted turn produced no evaluable work.
  if (info.aborted) {
    controller.pause();
    const detail = "Turn aborted by user.";
    deps.notify(`◎ /goal paused — ${detail} Run /goal resume to continue.`, "warning");
    await deps.recordEvent({ type: "goal_paused", summary: detail, outcome: "user-abort" });
    return;
  }

    const action = controller.onTurnEnd(deps.getTokens());
  switch (action.kind) {
    case "continue":
      deps.issueContinuation?.(action.directive);
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
