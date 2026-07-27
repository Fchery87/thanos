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
  /**
   * False only when the user declined an explicit spec at the approval gate.
   * Required (not optional) on purpose: the safe-looking default is `true`, so a
   * call site that forgot this field would silently restart refused work. Making
   * it explicit fails closed at compile time instead.
   */
  specApproved: boolean;
}

export function shouldReinject(input: ReinjectInputs): boolean {
  if (!input.enabled) return false;
  if (input.aborted) return false;
  // A declined approval is the user refusing the work, not an unmet criterion.
  // Belt-and-braces with SpecEngine.rejectActiveSpec(), which already drops the
  // spec so there are no results to act on — this guard keeps the refusal
  // authoritative even if a future change stops clearing it.
  if (!input.specApproved) return false;
  if (input.goalActive) return false;
  if (input.isSubagent) return false;
  if (input.results.length === 0) return false;
  if (input.attempts >= GATE_MAX_ATTEMPTS) return false;
  // Advisory criteria (audits, investigations, catch-all demonstrations) are
  // informational — a failing advisory criterion must never drive continuation,
  // or non-machine-verifiable prompts loop until the attempt budget is spent.
  return input.results.some((result) => !result.passed && !result.advisory);
}

export function buildContinuationPrompt(results: VerificationResult[], attempts: number): string {
  const unmet = results
    .filter((result) => !result.passed && !result.advisory)
    .map((result) => {
      const missing = result.missingEvidence.length > 0
        ? ` (missing: ${result.missingEvidence.join(", ")})`
        : "";
      return `- ${result.criterion.statement}${missing}`;
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
