import type { Context } from "@earendil-works/pi-ai";

/**
 * Marks every goal-injected user message. before_agent_start treats this like
 * GATE_CONTINUE_SENTINEL: it skips spec.startTurn(), so a goal turn never
 * regenerates the spec or wipes collected evidence.
 */
export const GOAL_DIRECTIVE_SENTINEL = "[harness:goal-directive]";

export const EVALUATOR_SYSTEM = [
  "You are a fresh completion checker. You did NOT do the work.",
  "Decide ONLY from the evidence surfaced below whether the condition is met.",
  "You cannot run tools; if the evidence does not prove the condition, it is NOT met.",
  "Reply in exactly this format and nothing else:",
  "VERDICT: MET|NOT_MET",
  "REASON: <one short line>",
].join("\n");

/**
 * The worker must know how it is judged: a tool-less checker sees ONLY the
 * final message + last tool outputs of each turn, so unsurfaced work reads as
 * no progress and burns ceiling turns on NOT_MET verdicts.
 */
const EVIDENCE_CONTRACT = [
  "How you are judged: after each of your turns, a separate checker that cannot run tools",
  "reads ONLY your final message and the last tool outputs. Work it cannot see does not count.",
  "End every reply with the concrete evidence so far (test output, exit codes, counts, git",
  "status) — and when you believe the goal is met, paste the proof.",
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
  return [
    "A /goal is active. Work autonomously toward it until it is fully resolved:",
    "",
    `<goal_condition>\n${condition}\n</goal_condition>`,
    "",
    "Goal-mode rules:",
    "- Keep going until the condition is completely met end-to-end. Do not stop at",
    "  analysis, a plan, a TODO list, partial fixes, or suggested next steps.",
    "- Do not redefine the goal into a smaller task; satisfy every requirement.",
    "- Batch the work: carry each turn as far as you can rather than pausing after a",
    "  single step — you are re-prompted automatically each turn until you signal done.",
    "- Signal completion yourself: when every requirement is met AND verified, call the",
    "  `goal_complete` tool with a summary of what you did and the evidence that proves",
    "  it. A fresh tool-less checker confirms before the goal closes, so include real",
    "  proof (test output, exit codes, counts). Do not call it for partial progress.",
    "- Treat the current worktree, command output, tests, and external state as",
    "  authoritative; re-check them rather than assuming.",
    "- Persevere through recoverable tool failures by trying reasonable alternatives.",
    "",
    EVIDENCE_CONTRACT,
  ].join("\n");
}

export function buildFirstDirective(condition: string): string {
  return [
    `${GOAL_DIRECTIVE_SENTINEL} Work toward this goal until it is met:`,
    "",
    condition,
    "",
    "When it is fully met and verified, call the `goal_complete` tool with the proof.",
    EVIDENCE_CONTRACT,
  ].join("\n");
}

/**
 * Sent after each work turn that did not close the goal. Unlike buildDirective
 * there is no evaluator "reason" — completion is agent-signaled now, so the
 * continuation only re-states the goal and how to finish it (call goal_complete).
 */
export function buildContinueDirective(condition: string): string {
  return [
    `${GOAL_DIRECTIVE_SENTINEL} The /goal is still active — keep working until it is fully met:`,
    "",
    condition,
    "",
    "When every requirement is met AND verified, call the `goal_complete` tool with a",
    "summary and the evidence that proves it. A fresh checker confirms before the goal",
    "closes; until then you will be prompted to continue.",
    EVIDENCE_CONTRACT,
  ].join("\n");
}

export function buildDirective(condition: string, reason: string): string {
  return [
    `${GOAL_DIRECTIVE_SENTINEL} Goal not yet met.`,
    "",
    condition,
    "",
    `Not yet met: ${reason}. Continue toward the condition.`,
    EVIDENCE_CONTRACT,
  ].join("\n");
}

export interface EvaluatorInput {
  condition: string;
  lastAssistantText: string;
  toolResultsText: string;
  previousReason?: string;
}

export function buildEvaluatorContext(input: EvaluatorInput): Context {
  const body = [
    `CONDITION:\n${input.condition}`,
    input.previousReason ? `\nPREVIOUS CHECK:\n${input.previousReason}` : "",
    `\nLAST ASSISTANT MESSAGE:\n${input.lastAssistantText || "(empty)"}`,
    `\nLAST TOOL RESULTS:\n${input.toolResultsText || "(none)"}`,
  ].join("\n");
  return { systemPrompt: EVALUATOR_SYSTEM, messages: [{ role: "user", content: body, timestamp: Date.now() }] };
}
