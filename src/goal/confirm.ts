import type { EvaluatorInput } from "./prompts";
import type { Verdict } from "./types";

/** The last work turn's surfaced evidence, as extracted by extractLastTurn. */
export interface CompletionEvidence {
  lastAssistantText: string;
  toolResultsText: string;
}

export interface ConfirmInput {
  condition: string;
  previousReason?: string;
  /** The agent's own completion claim (untrusted — prepended, never judged alone). */
  summary: string;
  evidence: CompletionEvidence;
}

type RunEvaluator = (input: EvaluatorInput) => Promise<Verdict>;

/**
 * Judge an agent-signaled `goal_complete`. Fails CLOSED, never open — a goal
 * only ever closes on a MET verdict backed by real turn evidence:
 *
 *  - No verifiable evidence in the turn (empty assistant text AND empty tool
 *    output) → NOT_MET without consulting the model. Judging the agent's own
 *    summary claim alone would reinstate exactly the self-grading the fresh,
 *    tool-less checker exists to prevent, so "no evidence" can never yield MET.
 *    This is the guard for the case where the session-branch read comes back
 *    empty (API shape drift, or goal_complete called before any proof turn).
 *  - Primary evaluator error → retry once via `runFallback` (the session model).
 *  - Both error → fail SAFE to NOT_MET: a checker error must never close a goal
 *    and must never pause it; the agent simply keeps working and re-signals.
 *
 * The agent summary is prepended to the surfaced evidence so the checker sees
 * the claim in context, but the claim alone is never sufficient (the guard
 * above requires independent turn evidence to exist first).
 */
export async function confirmGoalCompletion(
  input: ConfirmInput,
  runPrimary: RunEvaluator,
  runFallback: RunEvaluator,
): Promise<Verdict> {
  const { lastAssistantText, toolResultsText } = input.evidence;
  if (!lastAssistantText.trim() && !toolResultsText.trim()) {
    return {
      met: false,
      reason:
        "no verifiable evidence in this turn — a tool-less checker judges only your final " +
        "message and last tool outputs, so surface the proof (test output, exit codes, git " +
        "status) in the same turn as goal_complete, then call it again",
    };
  }

  const summary = (input.summary ?? "").trim();
  const claim = summary ? `AGENT COMPLETION CLAIM:\n${summary}\n\n${lastAssistantText}` : lastAssistantText;
  const evalInput: EvaluatorInput = {
    condition: input.condition,
    assistantClaim: claim,
    toolResultsText,
    previousReason: input.previousReason,
  };

  try {
    return await runPrimary(evalInput);
  } catch {
    try {
      return await runFallback(evalInput);
    } catch (e) {
      return {
        met: false,
        reason: `completion check errored (${(e as Error).message}); re-verify the evidence and call goal_complete again`,
      };
    }
  }
}
