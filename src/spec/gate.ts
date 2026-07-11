import type { VerificationResult } from "./verification";

export const GATE_MAX_ATTEMPTS = 3;
export const GATE_CONTINUE_SENTINEL = "[harness:verify-continue]";

export interface ReinjectInputs {
  results: VerificationResult[];
  attempts: number;
  isSubagent: boolean;
  enabled: boolean;
  /** While a /goal is active, the goal evaluator is the sole continuation driver. */
  goalActive: boolean;
  /** True when the user aborted the turn (ESC) — never restart aborted work. */
  aborted?: boolean;
}

export function shouldReinject(input: ReinjectInputs): boolean {
  if (!input.enabled) return false;
  if (input.aborted) return false;
  if (input.goalActive) return false;
  if (input.isSubagent) return false;
  if (input.results.length === 0) return false;
  if (input.attempts >= GATE_MAX_ATTEMPTS) return false;
  return input.results.some((result) => !result.passed);
}

export function buildContinuationPrompt(results: VerificationResult[], attempts: number): string {
  const unmet = results
    .filter((result) => !result.passed)
    .map((result) => {
      const evidence = result.criterion.evidenceRequired.join(", ") || "none";
      return `- ${result.criterion.statement} (needs evidence: ${evidence})`;
    });

  return [
    `${GATE_CONTINUE_SENTINEL} The task is not done: acceptance criteria are unverified (verification attempt ${attempts + 1} of ${GATE_MAX_ATTEMPTS}).`,
    "",
    "Unmet criteria:",
    ...unmet,
    "",
    "Do not stop or summarize as complete. Produce the missing evidence: run the tests/build/lint or take the action each criterion requires, then continue. If a criterion is genuinely unverifiable or wrong, say so explicitly and explain why rather than silently dropping it.",
  ].join("\n");
}
