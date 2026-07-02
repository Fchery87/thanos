import type { AcceptanceCriterion } from "./types";

export interface EvaluatorPromptInput {
  goal: string;
  criteria: AcceptanceCriterion[];
}

export function buildEvaluatorPrompt(input: EvaluatorPromptInput): string {
  const criteria = input.criteria
    .map((criterion, index) => {
      const evidence = criterion.evidenceRequired.join(", ");
      return `${index + 1}. [${criterion.id}] ${criterion.statement}\n   Evidence required: ${evidence}`;
    })
    .join("\n");

  return [
    "Use the subagent tool to run the evaluator agent.",
    "The evaluator must grade this from a fresh context and must not rely on builder claims.",
    "",
    `Goal: ${input.goal}`,
    "",
    "Criteria:",
    criteria || "1. No criteria supplied. Return NEEDS_WORK and request a concrete contract.",
    "",
    "Require the evaluator to return PASS or NEEDS_WORK first, followed by per-criterion evidence.",
  ].join("\n");
}
