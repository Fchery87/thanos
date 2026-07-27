import type { AcceptanceCriterion } from "./types";
import type { TaskContract } from "./task-contract";

export interface DefaultFailContract {
  acceptanceCriteria: AcceptanceCriterion[];
  notes: string[];
}

export function buildContractFromTaskContract(taskContract: TaskContract): DefaultFailContract {
  return {
    acceptanceCriteria: taskContract.criteria.map((criterion) => ({
      id: criterion.id,
      statement: criterion.statement,
      evidenceRequired: [...criterion.evidence],
      ...(criterion.evidenceAnyOf ? { evidenceAnyOf: criterion.evidenceAnyOf.map((group) => [...group]) } : {}),
    })),
    notes: ["Criteria are default-fail until matching evidence is collected."],
  };
}
