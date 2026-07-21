import type { AcceptanceCriterion } from "./types";
import { buildPromptSections, renderCompletionCriteria } from "../prompts/style";

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

  return buildPromptSections([
    { heading: "Question", body: "How should the evaluator grade this change?" },
    { heading: "Mental model", body: "Grade from a fresh context and trust only supplied evidence." },
    { heading: "Goal", body: input.goal },
    { heading: "Criteria", body: criteria || "1. No criteria supplied. Return NEEDS_WORK and request a concrete contract." },
    { heading: "Check", body: renderCompletionCriteria(["return PASS or NEEDS_WORK first", "include per-criterion evidence"]) },
  ]);
}
