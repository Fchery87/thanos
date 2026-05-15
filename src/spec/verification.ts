import type { EvidenceRecord } from "./evidence";
import type { FormalSpec, AcceptanceCriterion } from "./types";

export interface VerificationResult {
  criterion: AcceptanceCriterion;
  passed: boolean;
  evidence: string[];
}

function evidenceForCriterion(criterion: AcceptanceCriterion, evidence: EvidenceRecord[]): EvidenceRecord[] {
  return evidence.filter((record) => record.passed && criterion.evidenceRequired.includes(record.type));
}

export function verifyCriteria(spec: FormalSpec, evidence: EvidenceRecord[]): VerificationResult[] {
  return spec.acceptanceCriteria.map((criterion) => {
    const matchingEvidence = evidenceForCriterion(criterion, evidence);
    const passed = criterion.evidenceRequired.every((type) =>
      matchingEvidence.some((record) => record.type === type),
    );
    return { criterion, passed, evidence: matchingEvidence.map((record) => record.summary) };
  });
}
