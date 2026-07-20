import type { VerificationResult } from "../spec/verification";

export type ContinuationDecision =
  | "stop"
  | "continue_spec"
  | "continue_goal"
  | "await_user"
  | "retry_runtime"
  | "pause_budget";

export interface TurnCompletion {
  results: VerificationResult[];
  gateAttempts: number;
  isSubagent: boolean;
  gateEnabled: boolean;
  goalActive: boolean;
  aborted: boolean;
  hasUI: boolean;
  turnCount: number;
  maxTurns: number;
}

const MAX_GATE_ATTEMPTS = 3;

export class ContinuationArbiter {
  decide(input: TurnCompletion): ContinuationDecision {
    // Abort always wins
    if (input.aborted) return "stop";

    // Subagents don't get continuation
    if (input.isSubagent) return "stop";

    // Budget exhaustion
    if (input.turnCount >= input.maxTurns) return "pause_budget";

    // Goal loop is the sole continuation driver when active
    if (input.goalActive) return "continue_goal";

    // Spec gate: re-inject if there are failing criteria and budget remains
    if (
      input.gateEnabled
      && input.results.length > 0
      && input.gateAttempts < MAX_GATE_ATTEMPTS
      && input.results.some((r) => !r.passed)
    ) {
      return "continue_spec";
    }

    // No spec or all criteria passed
    return "stop";
  }
}
