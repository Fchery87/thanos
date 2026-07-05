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

export function buildFirstDirective(condition: string): string {
  return [
    `${GOAL_DIRECTIVE_SENTINEL} Work toward this goal until it is met:`,
    "",
    condition,
    "",
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
