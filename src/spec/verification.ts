import type { EvidenceRecord } from "./claims";
import type { FormalSpec, AcceptanceCriterion } from "./types";

export interface VerificationResult {
  criterion: AcceptanceCriterion;
  passed: boolean;
  evidence: string[];
  missingEvidence: string[];
}

function evidenceMatches(criterion: AcceptanceCriterion, record: EvidenceRecord): boolean {
  if (!record.passed) return false;
  for (const req of criterion.evidenceRequired) {
    if (req === "diff" && record.kind === "diff") return true;
    if (req === "test" && record.kind === "test") return true;
    if (req === "command" && record.kind === "command") return true;
    if (req === "manual" && record.kind === "manual") return true;
  }
  return false;
}

function evidenceSummary(record: EvidenceRecord): string {
  switch (record.kind) {
    case "diff":
      return `diff: [${record.paths.join(", ")}]`;
    case "test":
      return `${record.runner} (exit ${record.exitCode})`;
    case "command":
      return `${record.argv.join(" ")} (exit ${record.exitCode})`;
    case "manual":
      return `manual: ${record.actor} — ${record.claim.slice(0, 80)}`;
  }
}

export function verifyCriteria(spec: FormalSpec, evidence: EvidenceRecord[]): VerificationResult[] {
  if (spec.acceptanceCriteria.length === 0) {
    process.stderr.write(`[spec] WARNING: spec "${spec.id}" has no acceptance criteria — verification cannot pass\n`);
    return [
      {
        criterion: {
          id: "no-criteria",
          statement: "No verifiable criteria generated for this goal",
          evidenceRequired: [],
        },
        passed: false,
        evidence: [],
        missingEvidence: ["no criteria defined"],
      },
    ];
  }

  return spec.acceptanceCriteria.map((criterion) => {
    const matchingEvidence = evidence.filter((record) => evidenceMatches(criterion, record));
    const matchedTypes = new Set(matchingEvidence.map((e) => e.kind));

    const missingEvidence = criterion.evidenceRequired
      .filter((req) => !matchedTypes.has(req));

    const passed = missingEvidence.length === 0;

    return {
      criterion,
      passed,
      evidence: matchingEvidence.map(evidenceSummary),
      missingEvidence,
    };
  });
}
