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

export function buildDefaultFailContract(prompt: string): DefaultFailContract {
  const lower = prompt.toLowerCase();
  const acceptanceCriteria: AcceptanceCriterion[] = [];

  if (/\b(add|build|create|implement|update|remove|migrate)\b/.test(lower)) {
    acceptanceCriteria.push({
      id: "contract-diff",
      statement: "Requested code change is implemented in the relevant files",
      evidenceRequired: ["diff"],
    });
  }

  if (/\b(tests?|testing|verify|verification|regression|coverage)\b/.test(lower)) {
    acceptanceCriteria.push({
      id: "contract-tests",
      statement: "Relevant tests or verification commands pass",
      evidenceRequired: ["test"],
    });
  }

  if (/\bdoc|readme|adr|plan\b/.test(lower)) {
    acceptanceCriteria.push({
      id: "contract-docs",
      statement: "Requested documentation is updated",
      evidenceRequired: ["diff"],
    });
  }

  if (/\brefactor|cleanup|deslop\b/.test(lower)) {
    acceptanceCriteria.push({
      id: "contract-refactor",
      statement: "Behavior is preserved while the code structure is improved",
      evidenceRequired: ["diff", "command"],
    });
  }

  if (acceptanceCriteria.length === 0) {
    acceptanceCriteria.push({
      id: "contract-manual",
      statement: "Task outcome is explicitly demonstrated",
      evidenceRequired: ["manual"],
    });
  }

  return {
    acceptanceCriteria,
    notes: ["Criteria are default-fail until matching evidence is collected."],
  };
}
