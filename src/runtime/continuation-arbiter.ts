import type { VerificationResult } from "../spec/verification";

export type ContinuationDecision =
  | "stop"
  | "continue_spec"
  | "continue_goal"
  | "await_user"
  | "retry_runtime"
  | "pause_budget";

export interface ContinuationArbiterResult {
  decision: ContinuationDecision;
  selectedDriver: "none" | "goal" | "spec" | "budget";
  rejectedDrivers: Array<"goal" | "spec" | "budget">;
}

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
  decide(input: TurnCompletion): ContinuationArbiterResult {
    // Abort always wins
    if (input.aborted) return { decision: "stop", selectedDriver: "none", rejectedDrivers: ["goal", "spec", "budget"] };

    // Subagents don't get continuation
    if (input.isSubagent) return { decision: "stop", selectedDriver: "none", rejectedDrivers: ["goal", "spec", "budget"] };

    // Budget exhaustion
    if (input.turnCount >= input.maxTurns) {
      return { decision: "pause_budget", selectedDriver: "budget", rejectedDrivers: ["goal", "spec"] };
    }

    // Goal loop is the sole continuation driver when active
    if (input.goalActive) {
      return { decision: "continue_goal", selectedDriver: "goal", rejectedDrivers: ["spec", "budget"] };
    }

    // Spec gate: re-inject if there are failing criteria and budget remains
    if (
      input.gateEnabled
      && input.results.length > 0
      && input.gateAttempts < MAX_GATE_ATTEMPTS
      && input.results.some((r) => !r.passed)
    ) {
      return { decision: "continue_spec", selectedDriver: "spec", rejectedDrivers: ["goal", "budget"] };
    }

    // No spec or all criteria passed
    return { decision: "stop", selectedDriver: "none", rejectedDrivers: ["goal", "spec", "budget"] };
  }
}
