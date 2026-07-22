import type { TaskContract, TaskCriterion, TaskCriterionKind, TaskCriterionSource, TaskEvidenceIdentity, TaskVerificationMode } from "./task-contract";

const MAX_CRITERIA = 8;
const MAX_TARGETS = 8;
const MAX_MUST_NOT = 8;
const MAX_EXPECTED_ARGS = 8;
const MAX_EXPECTED_EXECUTABLES = 8;

const VALID_KINDS = new Set<TaskCriterionKind>(["rename", "fix", "build", "audit", "secure", "investigate", "manual"]);
const VALID_SOURCES = new Set<TaskCriterionSource>(["user", "deterministic_fallback", "semantic_extraction"]);
const VALID_EVIDENCE = new Set<TaskEvidenceIdentity>(["diff", "test", "command", "manual"]);
const VALID_VERIFICATION_MODES = new Set<TaskVerificationMode>(["advisory", "gated"]);
const VALID_TARGET = /^(src|tests|docs|scripts|packages|lib|app)(?:[\/].+)?$|^(README|CHANGELOG|CONTRIBUTING|package\.json|tsconfig\.json|vitest\.config\.[cm]?js)$/i;
const VALID_EXECUTABLE = /^(?:[a-z][a-z0-9_.-]*|bun test|npm test|pnpm test|yarn test|git grep)$/i;
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
  if (!expectedExecutables.every((item) => VALID_EXECUTABLE.test(item))) return undefined;
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
