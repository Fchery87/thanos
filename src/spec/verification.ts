import type { EvidenceRecord } from "./claims";
import type { TaskCriterionSource } from "./task-contract";
import type { FormalSpec, AcceptanceCriterion } from "./types";

/**
 * Commands that inspect or print rather than verify.
 *
 * Rejected only for GATED criteria, where a command stands in as proof that the
 * work is correct — `echo done` must never satisfy "the fix is verified". For an
 * advisory criterion the command merely corroborates analysis, and there
 * inspection is the entire point: an audit's evidence genuinely is ripgrep.
 *
 * Deliberately a denylist, not an allowlist. `risk.ts` fails safe toward asking
 * permission, where over-restriction merely costs a prompt; here over-restriction
 * means rejecting genuine evidence, which sends the gate into exactly the retry
 * loop this whole plan exists to eliminate. An unrecognized command is far more
 * likely to be a real build tool than a trick, so unknown stays accepted.
 */
const REJECTED_COMMAND_EXECUTABLES = new Set([
  "echo", "printf", "true", "false", ":", "sleep",
  "cat", "head", "tail", "wc", "ls", "pwd", "cd", "which", "file", "stat",
  "realpath", "basename", "dirname", "tree", "date", "whoami", "env", "printenv",
  "grep", "egrep", "fgrep", "rg", "find", "git grep",
]);

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
  /**
   * Provenance of {@link criterion}, surfaced here so the gate never has to
   * reach back into the task contract. `deterministic_fallback` criteria are
   * reported but never drive a continuation — see `gatedFailures`.
   */
  source?: TaskCriterionSource;
}

/** Every evidence kind this criterion can be satisfied by: the required set plus
 * every kind mentioned in an anyOf group. */
function acceptableKinds(criterion: AcceptanceCriterion): Set<EvidenceRecord["kind"]> {
  const kinds = new Set<EvidenceRecord["kind"]>(criterion.evidenceRequired);
  for (const group of criterion.evidenceAnyOf ?? []) {
    for (const kind of group) kinds.add(kind);
  }
  return kinds;
}

function evidenceMatches(criterion: AcceptanceCriterion, record: EvidenceRecord): boolean {
  if (!record.passed) return false;
  return acceptableKinds(criterion).has(record.kind);
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
  const gated = taskCriterion.verificationMode !== "advisory";
  if (gated && REJECTED_COMMAND_EXECUTABLES.has(record.normalizedExecutable)) return false;
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
          : record.kind === "manual"
            ? `${record.actor} ${record.claim} ${(record.scope ?? []).join(" ")}`
            : `${record.workflowId} ${record.nodes.map((node) => `${node.ownerRunId}/${node.nodeId}/${node.runId}`).join(" ")}`;
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
    case "workflow":
      return `workflow ${record.workflowId}: ${record.nodes.map((node) => `${node.ownerRunId}/${node.nodeId}/${node.runId}`).join(", ")}`;
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
      if (record.kind === "workflow") return false;
      return true;
    });
    const matchedTypes = new Set(matchingEvidence.map((e) => e.kind));

    const missingRequired = criterion.evidenceRequired
      .filter((req) => !matchedTypes.has(req))
      .map((req) => (hasFailedEvidence(req, evidence) ? `${req} (failed)` : req));

    // Each anyOf group needs at least one of its kinds matched; report an unmet
    // group as "test|command" so the continuation prompt shows the alternatives.
    const missingGroups = (criterion.evidenceAnyOf ?? [])
      .filter((group) => !group.some((kind) => matchedTypes.has(kind)))
      .map((group) => {
        const label = group.join("|");
        return group.some((kind) => hasFailedEvidence(kind, evidence)) ? `${label} (failed)` : label;
      });

    const missingEvidence = [...missingRequired, ...missingGroups];

    // Scoped to THIS criterion's matching evidence, not the whole turn's. Until
    // the extractor landed, `mustNot` only ever held one hardcoded phrase and so
    // could not fire; with real values it becomes live, and an unscoped scan
    // would fail a criterion because of evidence belonging to a different one.
    const mustNotViolation = taskCriterion ? !mustNotIsSatisfied(taskCriterion.mustNot ?? [], matchingEvidence) : false;
    const passed = missingEvidence.length === 0 && !mustNotViolation;

    return {
      criterion,
      passed,
      advisory: taskCriterion?.verificationMode === "advisory",
      source: criterion.source ?? taskCriterion?.source,
      evidence: matchingEvidence.map(evidenceSummary),
      missingEvidence: mustNotViolation ? [...missingEvidence, "mustNot"] : missingEvidence,
    };
  });
}
