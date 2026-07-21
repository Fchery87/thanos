import type { Context } from "@earendil-works/pi-ai";
import { buildEvaluatorEvidenceMessage, EVALUATOR_RUBRIC } from "../evaluation/prompt-boundary";
import { buildPromptSections, renderCompletionCriteria, renderContextEnvelope } from "../prompts/style";

/**
 * Marks every goal-injected user message. before_agent_start treats this like
 * GATE_CONTINUE_SENTINEL: it skips spec.startTurn(), so a goal turn never
 * regenerates the spec or wipes collected evidence.
 */
export const GOAL_DIRECTIVE_SENTINEL = "[harness:goal-directive]";

export const EVALUATOR_SYSTEM = EVALUATOR_RUBRIC;

/**
 * The worker must know how it is judged. The checker runs ONLY when the agent
 * calls `goal_complete` (not per turn) and is tool-less: it sees ONLY the final
 * message + last tool outputs of the turn in which goal_complete is called, so
 * proof that is not surfaced in that same turn does not count.
 */
const EVIDENCE_CONTRACT = [
  "How you are judged: when you call `goal_complete`, a separate checker that cannot run tools",
  "reads ONLY your final message and the last tool outputs of that turn. Work it cannot see",
  "does not count — keep the concrete proof (test output, exit codes, counts, git status) in",
  "the same turn where you call `goal_complete`.",
].join("\n");

/**
 * The completion protocol, single-sourced like EVIDENCE_CONTRACT so a change
 * (renaming the tool, adding a required field) propagates to the system prompt
 * and every directive at once instead of drifting across hand-copied variants.
 */
const COMPLETION_CONTRACT = [
  "Signal completion yourself: when every requirement is met AND verified, call the",
  "`goal_complete` tool with a summary of what you did and the evidence that proves it.",
  "A fresh, tool-less checker confirms before the goal closes, so include real proof",
  "(test output, exit codes, counts). Do not call it for partial progress, a plan, or",
  "unverified work.",
].join("\n");

/**
 * Persistence rules injected into the system prompt on every active-goal turn
 * (see before_agent_start). Unlike the per-turn directives — which arrive as
 * user messages AFTER the agent has already decided to stop — this stands in
 * the system prompt for the whole turn, pushing the agent to finish more work
 * per turn and stop less. Fewer turns means fewer evaluator calls and far less
 * chance of nearing the turn ceiling. It restates the evidence contract because
 * the judge is tool-less: unsurfaced work reads as no progress.
 */
export function buildGoalSystemPrompt(condition: string): string {
  return buildPromptSections([
    { heading: "Question", body: "What should the worker do when a /goal is active?" },
    {
      heading: "Mental model",
      body: "Keep working until the goal is fully resolved. Runtime state and evidence govern; the prompt only explains the rule.",
    },
    {
      heading: "Goal condition",
      body: renderContextEnvelope({ origin: "goal", trusted: false, content: condition }),
    },
    {
      heading: "Action",
      body: [
        "- Keep going until the condition is completely met end-to-end.",
        "- Do not stop at analysis, a plan, a TODO list, partial fixes, or suggested next steps.",
        "- Treat the current worktree, command output, tests, and external state as authoritative.",
      ].join("\n"),
    },
    { heading: "Check", body: [COMPLETION_CONTRACT, EVIDENCE_CONTRACT].join("\n\n") },
  ]);
}

export function buildFirstDirective(condition: string): string {
  return [
    `${GOAL_DIRECTIVE_SENTINEL} Work toward this goal until it is met:`,
    "",
    condition,
    "",
    renderCompletionCriteria(["call goal_complete only when every requirement is verified"]),
    "",
    COMPLETION_CONTRACT,
    "",
    EVIDENCE_CONTRACT,
  ].join("\n");
}

/**
 * Sent after each work turn that did not close the goal. Deliberately terse: the
 * active condition, the goal-mode rules, the completion protocol, and how the
 * checker judges you all ride in the system prompt (buildGoalSystemPrompt) on
 * every active-goal turn, so re-sending them here would only duplicate — and
 * re-bill — that text (and burn the very token-growth ceiling the loop guards).
 */
export function buildContinueDirective(): string {
  return [
    `${GOAL_DIRECTIVE_SENTINEL} The /goal is still active — keep working until every`,
    "requirement is met AND verified, then call the `goal_complete` tool with the proof.",
    "(The active goal, the rules, and how you are judged are in your system prompt.)",
  ].join("\n");
}

export interface EvaluatorInput {
  condition: string;
  assistantClaim: string;
  toolResultsText: string;
  previousReason?: string;
}

export function buildEvaluatorContext(input: EvaluatorInput): Context {
  const body = buildEvaluatorEvidenceMessage({
    condition: input.condition,
    previousReason: input.previousReason,
    assistantClaim: input.assistantClaim,
    toolResultsText: input.toolResultsText,
  });
  return { systemPrompt: EVALUATOR_SYSTEM, messages: [{ role: "user", content: body, timestamp: Date.now() }] };
}
