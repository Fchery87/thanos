import type { TaskContract, TaskCriterion, TaskCriterionKind, TaskCriterionSource, TaskEvidenceIdentity, TaskVerificationMode } from "./task-contract";
import { KNOWN_TEST_EXECUTABLES, MULTI_WORD_EXECUTABLES } from "./command-normalize";

const MAX_CRITERIA = 8;
const MAX_TARGETS = 8;
const MAX_MUST_NOT = 8;
const MAX_EXPECTED_ARGS = 8;
// Must never sit below what the deterministic contract itself emits, or the
// harness generates contracts it then rejects. These caps bound untrusted
// extractor payloads; the exact ceiling is immaterial at this scale.
const MAX_EXPECTED_EXECUTABLES = Math.max(12, KNOWN_TEST_EXECUTABLES.length);

const VALID_KINDS = new Set<TaskCriterionKind>(["rename", "fix", "build", "audit", "secure", "investigate", "manual"]);
const VALID_SOURCES = new Set<TaskCriterionSource>(["user", "deterministic_fallback", "semantic_extraction"]);
const VALID_EVIDENCE = new Set<TaskEvidenceIdentity>(["diff", "test", "command", "manual"]);
const VALID_VERIFICATION_MODES = new Set<TaskVerificationMode>(["advisory", "gated"]);

/**
 * Kinds whose correctness genuinely cannot be proved from tool telemetry, and so
 * the only ones allowed to be advisory.
 *
 * `advisory` means "never enforced", which makes it the one field an extractor
 * could use to weaken the gate — and the extractor's input is an untrusted user
 * request. A request that talks the model into marking a build criterion advisory
 * would produce a spec that verifies nothing. Rather than trusting the value, it
 * is clamped: advisory survives only where the deterministic ladder would also
 * have chosen it. Extraction can still upgrade gating, never relax it.
 */
const ADVISORY_ELIGIBLE_KINDS = new Set<TaskCriterionKind>(["audit", "investigate", "manual"]);
const VALID_TARGET = /^(src|tests|docs|scripts|packages|lib|app)(?:[\/].+)?$|^(README|CHANGELOG|CONTRIBUTING|package\.json|tsconfig\.json|vitest\.config\.[cm]?js)$/i;
// Single-token programs. Multi-word normalized forms ("go test", "node --test")
// cannot be expressed here and are checked against MULTI_WORD_EXECUTABLES, which
// is owned by the module that emits them — this regex previously carried a stale
// partial copy of that list, so a contract the harness generated itself could
// fail its own validation.
const VALID_EXECUTABLE = /^[a-z][a-z0-9_.-]*$/i;

function isValidExecutable(item: string): boolean {
  return VALID_EXECUTABLE.test(item) || MULTI_WORD_EXECUTABLES.has(item.toLowerCase());
}
const VALID_ARG = /^[a-z0-9_.:/=-]+$/i;
const VALID_MUST_NOT = /^[a-z0-9_.:/=\- ]+$/i;

function normalizeStringArray(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > max) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return strings.length === value.length ? strings : undefined;
}

function normalizeCriterion(value: unknown): TaskCriterion | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.statement !== "string") return undefined;
  if (typeof raw.kind !== "string" || !VALID_KINDS.has(raw.kind as TaskCriterionKind)) return undefined;
  if (typeof raw.source !== "string" || !VALID_SOURCES.has(raw.source as TaskCriterionSource)) return undefined;
  const evidence = normalizeStringArray(raw.evidence, 4);
  const targets = normalizeStringArray(raw.targets, MAX_TARGETS);
  const expectedExecutables = normalizeStringArray(raw.expectedExecutables, MAX_EXPECTED_EXECUTABLES);
  const expectedArgs = normalizeStringArray(raw.expectedArgs, MAX_EXPECTED_ARGS);
  const mustNot = normalizeStringArray(raw.mustNot, MAX_MUST_NOT);
  if (!evidence || !targets || !expectedExecutables || !expectedArgs || !mustNot) return undefined;
  if (!evidence.every((item) => VALID_EVIDENCE.has(item as TaskEvidenceIdentity))) return undefined;
  if (!targets.every((item) => VALID_TARGET.test(item))) return undefined;
  if (!expectedExecutables.every(isValidExecutable)) return undefined;
  if (!expectedArgs.every((item) => VALID_ARG.test(item))) return undefined;
  if (!mustNot.every((item) => VALID_MUST_NOT.test(item))) return undefined;
  // Optional; a malformed value is rejected (rather than silently coerced) so an
  // extractor cannot smuggle an unknown mode past the gate.
  let verificationMode: TaskVerificationMode | undefined;
  if (raw.verificationMode !== undefined) {
    if (typeof raw.verificationMode !== "string" || !VALID_VERIFICATION_MODES.has(raw.verificationMode as TaskVerificationMode)) {
      return undefined;
    }
    verificationMode = raw.verificationMode as TaskVerificationMode;
  }
  const kind = raw.kind as TaskCriterionKind;
  if (verificationMode === "advisory" && !ADVISORY_ELIGIBLE_KINDS.has(kind)) {
    verificationMode = "gated";
  }
  // Optional anyOf groups: an array of non-empty groups, each of valid evidence
  // kinds. A malformed value is rejected outright, not coerced.
  let evidenceAnyOf: TaskEvidenceIdentity[][] | undefined;
  if (raw.evidenceAnyOf !== undefined) {
    if (!Array.isArray(raw.evidenceAnyOf) || raw.evidenceAnyOf.length > 4) return undefined;
    const groups: TaskEvidenceIdentity[][] = [];
    for (const rawGroup of raw.evidenceAnyOf) {
      const group = normalizeStringArray(rawGroup, 4);
      if (!group || group.length === 0) return undefined;
      if (!group.every((item) => VALID_EVIDENCE.has(item as TaskEvidenceIdentity))) return undefined;
      groups.push(group as TaskEvidenceIdentity[]);
    }
    evidenceAnyOf = groups;
  }
  return {
    id: raw.id.trim(),
    kind: raw.kind as TaskCriterionKind,
    statement: raw.statement.trim(),
    targets,
    evidence: evidence as TaskEvidenceIdentity[],
    expectedExecutables,
    expectedArgs,
    mustNot,
    source: raw.source as TaskCriterionSource,
    ...(verificationMode ? { verificationMode } : {}),
    ...(evidenceAnyOf ? { evidenceAnyOf } : {}),
  };
}

export function validateTaskContract(value: unknown): TaskContract | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.objective !== "string" || !Array.isArray(raw.criteria) || raw.criteria.length === 0 || raw.criteria.length > MAX_CRITERIA) {
    return undefined;
  }
  const criteria = raw.criteria.map(normalizeCriterion);
  if (criteria.some((criterion) => !criterion)) return undefined;
  return {
    objective: raw.objective.trim(),
    criteria: criteria as TaskCriterion[],
  };
}
