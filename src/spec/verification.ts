import type { EvidenceRecord } from "./claims";
import type { FormalSpec, AcceptanceCriterion } from "./types";

const REJECTED_COMMAND_EXECUTABLES = new Set(["printf", "echo", "git grep", "grep"]);

export interface VerificationResult {
  criterion: AcceptanceCriterion;
  passed: boolean;
  evidence: string[];
  missingEvidence: string[];
  /**
   * When true, this criterion is informational: it is reported but never drives
   * the continuation gate (see {@link TaskCriterion.verificationMode}). Defaults
   * to gated (false/undefined) when the source task criterion is unknown.
   */
  advisory?: boolean;
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

function pathsMatchTargets(targets: string[], paths: string[]): boolean {
  if (targets.length === 0) return true;
  return targets.some((target) => paths.some((path) => path === target || path.startsWith(`${target}/`) || target.startsWith(`${path}/`)));
}

function argvMatchesTargets(targets: string[], argv: string[]): boolean {
  if (targets.length === 0) return true;
  return targets.some((target) => argv.some((arg) => arg.includes(target) || target.includes(arg)));
}

function argsMatchExpected(expectedArgs: string[], argv: string[]): boolean {
  if (expectedArgs.length === 0) return true;
  const tokens = argv.flatMap((arg) => arg.split(/[\/_.:=\-]+/).filter(Boolean));
  return expectedArgs.every((expected) => tokens.includes(expected));
}

function executableMatchesExpected(expectedExecutables: string[], executable: string): boolean {
  if (expectedExecutables.length === 0) return true;
  return expectedExecutables.includes(executable);
}

function commandMatchesTaskCriterion(
  taskCriterion: NonNullable<FormalSpec["taskContract"]["criteria"][number]>,
  record: Extract<EvidenceRecord, { kind: "command" }>,
): boolean {
  const expectedExecutables = taskCriterion.expectedExecutables ?? [];
  const expectedArgs = taskCriterion.expectedArgs ?? [];
  if (REJECTED_COMMAND_EXECUTABLES.has(record.normalizedExecutable)) return false;
  return executableMatchesExpected(expectedExecutables, record.normalizedExecutable)
    && argsMatchExpected(expectedArgs, record.argv)
    && argvMatchesTargets(taskCriterion.targets, record.argv);
}

function mustNotIsSatisfied(mustNot: string[], evidence: EvidenceRecord[]): boolean {
  if (mustNot.length === 0) return true;
  return !evidence.some((record) => {
    if (!record.passed) return false;
    const text = record.kind === "diff"
      ? record.paths.join(" ")
      : record.kind === "test"
        ? `${record.runner} ${record.normalizedExecutable} ${record.args.join(" ")}`
        : record.kind === "command"
          ? `${record.family} ${record.normalizedExecutable} ${record.argv.join(" ")}`
          : `${record.actor} ${record.claim} ${(record.scope ?? []).join(" ")}`;
    return mustNot.some((forbidden) => text.toLowerCase().includes(forbidden.toLowerCase()));
  });
}

function testMatchesTaskCriterion(
  taskCriterion: NonNullable<FormalSpec["taskContract"]["criteria"][number]>,
  record: Extract<EvidenceRecord, { kind: "test" }>,
): boolean {
  const expectedExecutables = taskCriterion.expectedExecutables ?? [];
  const expectedArgs = taskCriterion.expectedArgs ?? [];
  return executableMatchesExpected(expectedExecutables, record.normalizedExecutable)
    && argsMatchExpected(expectedArgs, record.args)
    && argvMatchesTargets(taskCriterion.targets, record.args);
}

function hasFailedEvidence(req: AcceptanceCriterion["evidenceRequired"][number], evidence: EvidenceRecord[]): boolean {
  return evidence.some((record) => !record.passed && record.kind === req);
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
    const taskCriterion = spec.taskContract.criteria.find((candidate) => candidate.id === criterion.id);
    const matchingEvidence = evidence.filter((record) => {
      if (!evidenceMatches(criterion, record)) return false;
      if (!taskCriterion) return true;
      if (record.kind === "diff") return pathsMatchTargets(taskCriterion.targets, record.paths);
      if (record.kind === "test") return testMatchesTaskCriterion(taskCriterion, record);
      if (record.kind === "command") return commandMatchesTaskCriterion(taskCriterion, record);
      if (record.kind === "manual") return pathsMatchTargets(taskCriterion.targets, record.scope ?? []);
      return true;
    });
    const matchedTypes = new Set(matchingEvidence.map((e) => e.kind));

    const missingEvidence = criterion.evidenceRequired
      .filter((req) => !matchedTypes.has(req))
      .map((req) => (hasFailedEvidence(req, evidence) ? `${req} (failed)` : req));

    const mustNotViolation = taskCriterion ? !mustNotIsSatisfied(taskCriterion.mustNot ?? [], evidence) : false;
    const passed = missingEvidence.length === 0 && !mustNotViolation;

    return {
      criterion,
      passed,
      advisory: taskCriterion?.verificationMode === "advisory",
      evidence: matchingEvidence.map(evidenceSummary),
      missingEvidence: mustNotViolation ? [...missingEvidence, "mustNot"] : missingEvidence,
    };
  });
}
