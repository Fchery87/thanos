import type { GoalController } from "./controller";
import type { Verdict } from "./types";

export interface AgentEndInfo {
  willRetry: boolean;
  lastAssistantText: string;
  toolResultsText: string;
}

export interface GoalEventRecord {
  type: "goal_set" | "goal_achieved" | "goal_paused";
  summary: string;
  outcome: string;
}

export interface LoopDeps {
  controller: GoalController;
  runEvaluator: (lastAssistantText: string, toolResultsText: string, previousReason?: string) => Promise<Verdict>;
  sendDirective: (directive: string) => Promise<void>;
  notify: (message: string, level?: "info" | "warning") => void;
  recordEvent: (event: GoalEventRecord) => Promise<void>;
  getTokens: () => number;
  isSubagent: boolean;
}

export async function handleAgentEnd(deps: LoopDeps, info: AgentEndInfo): Promise<void> {
  const { controller } = deps;
  const snap = controller.snapshot();
  if (deps.isSubagent || info.willRetry || !snap || snap.status !== "active") return;

  let verdict: Verdict;
  try {
    verdict = await deps.runEvaluator(info.lastAssistantText, info.toolResultsText, snap.lastReason);
  } catch {
    try {
      verdict = await deps.runEvaluator(info.lastAssistantText, info.toolResultsText, snap.lastReason);
    } catch (e) {
      const action = controller.onError("eval-error", `Evaluator failed: ${(e as Error).message}`);
      if (action.kind === "paused") {
        deps.notify(`◎ /goal paused — ${action.detail} Run /goal resume to continue.`, "warning");
        await deps.recordEvent({ type: "goal_paused", summary: action.detail, outcome: action.why });
      }
      return;
    }
  }

  const action = controller.onTurnResult(verdict, deps.getTokens());
  switch (action.kind) {
    case "continue":
      await deps.sendDirective(action.directive);
      break;
    case "achieved":
      deps.notify(`◎ /goal achieved in ${action.turns} turns — ${action.reason}`);
      await deps.recordEvent({ type: "goal_achieved", summary: action.reason, outcome: `turns=${action.turns}` });
      break;
    case "paused":
      deps.notify(`◎ /goal paused — ${action.detail} Run /goal resume to continue.`, "warning");
      await deps.recordEvent({ type: "goal_paused", summary: action.detail, outcome: action.why });
      break;
    case "noop":
      break;
  }
}
