export interface GoalSettings {
  maxTurns: number;        // pause on hit; 0 = unlimited
  /**
   * Cumulative context-growth ceiling, NOT a spend cap. Accumulated as
   * max(0, tokensNow - lastTokens) per evaluated turn, so compaction
   * (which shrinks context) can never make the counter go backwards.
   */
  maxTokens: number;       // pause on hit; 0 = off
  checkpointEvery: number; // pause every N turns; 0 = off
  evaluatorRole: string;   // model-routing role for the evaluator
}

export const DEFAULT_GOAL_SETTINGS: GoalSettings = {
  maxTurns: 25, maxTokens: 0, checkpointEvery: 0, evaluatorRole: "evaluator",
};

export function resolveGoalSettings(partial?: Partial<GoalSettings>): GoalSettings {
  return { ...DEFAULT_GOAL_SETTINGS, ...(partial ?? {}) };
}

export type GoalStatus = "active" | "paused" | "achieved";

export interface GoalSnapshot {
  condition: string;
  status: GoalStatus;
  startedAt: number;
  turnsEvaluated: number;
  tokensUsed: number;      // cumulative clamped growth
  lastReason?: string;
  achieved?: { at: number; reason: string; turns: number };
}

export interface Verdict { met: boolean; reason: string }

export type PauseWhy = "ceiling-turns" | "ceiling-tokens" | "checkpoint" | "work-error" | "eval-error";

export type LoopAction =
  | { kind: "continue"; directive: string }
  | { kind: "achieved"; reason: string; turns: number }
  | { kind: "paused"; why: PauseWhy; detail: string }
  | { kind: "noop" };
