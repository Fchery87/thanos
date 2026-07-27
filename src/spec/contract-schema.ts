import { isAbsolute } from "node:path";
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
const MAX_TARGET_LENGTH = 200;

/**
 * A contract target is a repo-relative path prefix.
 *
 * This check is a security boundary, not a directory curator. It used to be a
 * whitelist of eight prefixes plus six root filenames, which rejected `agent/`,
 * `.harness/`, `evals/` and every root config file — paths this repo edits
 * constantly. A rejected target fails its criterion, and one failed criterion
 * rejects the entire contract, so curating directories here silently voided
 * whole extractions. The regex existed to stop path escape; that is all it does
 * now.
 *
 * Rejected: absolute paths, Windows drive and UNC paths (checked explicitly,
 * since `isAbsolute` is platform-dependent and this must not depend on where the
 * harness happens to run), `..` traversal, control characters, and `.` — which
 * is syntactically fine but matches no path in `pathsMatchTargets`, so it would
 * silently void every piece of evidence for its criterion.
 */
function isValidTarget(item: string): boolean {
  if (item.length === 0 || item.length > MAX_TARGET_LENGTH) return false;
  if (/[\u0000-\u001f]/.test(item)) return false;
  if (isAbsolute(item)) return false;
  if (/^[a-z]:[\\/]/i.test(item) || item.startsWith("\\\\")) return false;
  if (item === ".") return false;
  const segments = item.split(/[\\/]/);
  return segments.every((segment) => segment.length > 0 && segment !== "..");
}

/** Trailing slashes are cosmetic; targets are compared as strings, so strip them. */
function stripTrailingSlashes(item: string): string {
  return item.replace(/[\\/]+$/, "");
}
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

/**
 * An absent optional array is an empty one; a present malformed one is still
 * invalid.
 *
 * This distinction is the whole reason semantic extraction went 0-for-48. The
 * extractor prompt tells the model to "Omit rather than guess" for `targets` and
 * "or omit entirely" for `expectedExecutables` — good advice, since a wrong
 * target silently voids valid evidence. But `normalizeStringArray` returns
 * undefined for a missing field exactly as it does for a malformed one, so
 * omitting a field failed the criterion, and one failed criterion rejects the
 * whole contract. A model obeying the prompt could not produce an acceptable
 * contract. The malformed-value boundary is load-bearing and is untouched.
 */
function normalizeOptionalStringArray(value: unknown, max: number): string[] | undefined {
  if (value === undefined || value === null) return [];
  return normalizeStringArray(value, max);
}

/**
 * Why a criterion was refused, as a field name rather than a payload.
 *
 * The reason is the entire point: this validator rejected 48 consecutive
 * extractions and no one could say which field did it, because failure was a
 * bare `undefined`. The strings here reach the harness ledger, so they name the
 * field and the rule — never the value, which is model output derived from the
 * user's request.
 */
type CriterionResult =
  | { ok: true; criterion: TaskCriterion }
  | { ok: false; reason: string };

const fail = (reason: string): CriterionResult => ({ ok: false, reason });

function normalizeCriterionDetailed(value: unknown): CriterionResult {
  if (typeof value !== "object" || value === null) return fail("criterion is not an object");
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.statement !== "string") return fail("id/statement missing or not a string");
  if (typeof raw.kind !== "string" || !VALID_KINDS.has(raw.kind as TaskCriterionKind)) return fail("kind not in the allowed set");
  if (typeof raw.source !== "string" || !VALID_SOURCES.has(raw.source as TaskCriterionSource)) return fail("source not in the allowed set");
  // `evidence` stays required: it is the criterion's entire verification slot,
  // and a criterion with no acceptable evidence kind passes vacuously.
  const evidence = normalizeStringArray(raw.evidence, 4);
  const rawTargets = normalizeOptionalStringArray(raw.targets, MAX_TARGETS);
  const expectedExecutables = normalizeOptionalStringArray(raw.expectedExecutables, MAX_EXPECTED_EXECUTABLES);
  const expectedArgs = normalizeOptionalStringArray(raw.expectedArgs, MAX_EXPECTED_ARGS);
  const mustNot = normalizeOptionalStringArray(raw.mustNot, MAX_MUST_NOT);
  if (!evidence) return fail("evidence missing or malformed");
  if (!rawTargets) return fail("targets malformed");
  if (!expectedExecutables) return fail("expectedExecutables malformed");
  if (!expectedArgs) return fail("expectedArgs malformed");
  if (!mustNot) return fail("mustNot malformed");
  if (!evidence.every((item) => VALID_EVIDENCE.has(item as TaskEvidenceIdentity))) return fail("evidence kind not in diff|test|command|manual");
  const targets = rawTargets.map(stripTrailingSlashes);
  if (!targets.every(isValidTarget)) return fail("target is absolute, traverses with .., or is '.'");
  if (!expectedExecutables.every(isValidExecutable)) return fail("expectedExecutables not a normalized executable form");
  if (!expectedArgs.every((item) => VALID_ARG.test(item))) return fail("expectedArgs has disallowed characters");
  if (!mustNot.every((item) => VALID_MUST_NOT.test(item))) return fail("mustNot has disallowed characters");
  // Optional; a malformed value is rejected (rather than silently coerced) so an
  // extractor cannot smuggle an unknown mode past the gate.
  let verificationMode: TaskVerificationMode | undefined;
  if (raw.verificationMode !== undefined) {
    if (typeof raw.verificationMode !== "string" || !VALID_VERIFICATION_MODES.has(raw.verificationMode as TaskVerificationMode)) {
      return fail("verificationMode not advisory|gated");
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
    if (!Array.isArray(raw.evidenceAnyOf) || raw.evidenceAnyOf.length > 4) return fail("evidenceAnyOf not an array of at most 4 groups");
    const groups: TaskEvidenceIdentity[][] = [];
    for (const rawGroup of raw.evidenceAnyOf) {
      const group = normalizeStringArray(rawGroup, 4);
      if (!group || group.length === 0) return fail("evidenceAnyOf group is empty or malformed");
      if (!group.every((item) => VALID_EVIDENCE.has(item as TaskEvidenceIdentity))) return fail("evidenceAnyOf kind not in diff|test|command|manual");
      groups.push(group as TaskEvidenceIdentity[]);
    }
    evidenceAnyOf = groups;
  }
  // A criterion with no required evidence and no anyOf group has an empty
  // verification slot, so `verifyCriteria` finds nothing missing and passes it
  // unconditionally. Since Phase 0 made semantic criteria the only ones that
  // gate, admitting one of these would disarm the gate silently rather than
  // loudly — the failure mode this whole subsystem exists to prevent.
  if (evidence.length === 0 && (evidenceAnyOf?.length ?? 0) === 0) return fail("no evidence and no evidenceAnyOf — the criterion would pass vacuously");
  return { ok: true, criterion: {
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
  } };
}

export interface ContractValidation {
  contract?: TaskContract;
  /** Present exactly when `contract` is absent. Field-level, never a payload. */
  reason?: string;
}

/**
 * Validate a candidate and say why if it fails.
 *
 * Still all-or-nothing: one bad criterion rejects the whole contract, so a
 * partly-hallucinated payload cannot half-land. That boundary is deliberate.
 * What is new is that the refusal now has a reason attached, which is the
 * difference between "extraction produced nothing again" and "targets keep
 * getting rejected as absolute paths".
 */
export function validateTaskContractDetailed(value: unknown): ContractValidation {
  if (typeof value !== "object" || value === null) return { reason: "not an object" };
  const raw = value as Record<string, unknown>;
  if (typeof raw.objective !== "string") return { reason: "objective missing or not a string" };
  if (!Array.isArray(raw.criteria)) return { reason: "criteria is not an array" };
  if (raw.criteria.length === 0) return { reason: "criteria is empty" };
  if (raw.criteria.length > MAX_CRITERIA) return { reason: `criteria exceeds ${MAX_CRITERIA}` };

  const criteria: TaskCriterion[] = [];
  const candidates: unknown[] = raw.criteria;
  for (let index = 0; index < candidates.length; index++) {
    const result: CriterionResult = normalizeCriterionDetailed(candidates[index]);
    if (result.ok === false) return { reason: `criteria[${index}]: ${result.reason}` };
    criteria.push(result.criterion);
  }
  return { contract: { objective: raw.objective.trim(), criteria } };
}

export function validateTaskContract(value: unknown): TaskContract | undefined {
  return validateTaskContractDetailed(value).contract;
}
