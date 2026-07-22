export type TaskCriterionKind = "rename" | "fix" | "build" | "audit" | "secure" | "investigate" | "manual";
export type TaskCriterionSource = "user" | "deterministic_fallback" | "semantic_extraction";
export type TaskEvidenceIdentity = "diff" | "test" | "command" | "manual";

/**
 * Whether a criterion drives the continuation gate.
 *
 * - `gated` (default): unmet → the verify gate re-injects until evidence proves
 *   it, or the attempt budget is exhausted. Use only when the runtime can
 *   actually produce the required evidence (diff/test/command).
 * - `advisory`: surfaced in the turn summary but never re-injected. Use for
 *   criteria whose satisfaction depends on human/analytical judgement (audits,
 *   open-ended investigations, arbitrary demonstrations) — those are not
 *   machine-verifiable from tool telemetry, so gating on them loops forever.
 */
export type TaskVerificationMode = "advisory" | "gated";

export interface TaskCriterion {
  id: string;
  kind: TaskCriterionKind;
  statement: string;
  targets: string[];
  evidence: TaskEvidenceIdentity[];
  expectedExecutables: string[];
  expectedArgs: string[];
  mustNot: string[];
  source: TaskCriterionSource;
  /** Defaults to `gated` when omitted. */
  verificationMode?: TaskVerificationMode;
}

export interface TaskContract {
  objective: string;
  criteria: TaskCriterion[];
}

export function buildTaskContract(request: string): TaskContract {
  const lower = request.toLowerCase();

  if (/\brename\b/.test(lower)) {
    return {
      objective: request,
      criteria: [{
        id: "rename-primary",
        kind: "rename",
        statement: "Requested rename is applied consistently across the affected code paths",
        targets: ["src", "tests"],
        evidence: ["diff"],
        expectedExecutables: [],
        expectedArgs: [],
        mustNot: [],
        source: "deterministic_fallback",
      }],
    };
  }

  if (/\binvestigate\b/.test(lower)) {
    return {
      objective: request,
      criteria: [{
        id: "investigate-primary",
        kind: "investigate",
        statement: "Requested investigation explains the observed behavior with evidence-backed findings",
        targets: inferTargets(lower),
        // Advisory: an investigation's correctness is analytical, not provable
        // from tool telemetry. `command` corroborates but never gates. `manual`
        // is omitted because the runtime agent cannot emit it (only user/evaluator can).
        evidence: ["command"],
        expectedExecutables: inferExpectedExecutables(lower),
        expectedArgs: inferExpectedArgs(lower),
        mustNot: [],
        source: "deterministic_fallback",
        verificationMode: "advisory",
      }],
    };
  }

  if (/\baudit\b/.test(lower)) {
    return {
      objective: request,
      criteria: [{
        id: "audit-primary",
        kind: "audit",
        statement: "Requested audit findings are supported by direct evidence from the relevant surface",
        targets: inferTargets(lower),
        // Advisory: an audit's correctness is analytical, not provable from tool
        // telemetry. `command` corroborates but never gates. `manual` is omitted
        // because the runtime agent cannot emit it (only user/evaluator can).
        evidence: ["command"],
        expectedExecutables: inferExpectedExecutables(lower),
        expectedArgs: inferExpectedArgs(lower),
        mustNot: [],
        source: "deterministic_fallback",
        verificationMode: "advisory",
      }],
    };
  }

  if (/\bsecure\b/.test(lower)) {
    return {
      objective: request,
      criteria: [{
        id: "secure-primary",
        kind: "secure",
        statement: "Requested security hardening is applied without exposing the trust boundary",
        targets: inferTargets(lower),
        evidence: ["diff", /\b(test|verify|verification|policy)\b/.test(lower) ? "test" : "command"],
        expectedExecutables: inferExpectedExecutables(lower),
        expectedArgs: inferExpectedArgs(lower),
        mustNot: inferMustNot(lower),
        source: "deterministic_fallback",
      }],
    };
  }

  if (/\brefactor\b/.test(lower) || /\bcleanup\b/.test(lower) || /\bdeslop\b/.test(lower)) {
    return {
      objective: request,
      criteria: [{
        id: "refactor-primary",
        kind: "fix",
        statement: "Behavior is preserved while the code structure is improved",
        targets: inferTargets(lower),
        evidence: ["diff", /\b(tests?|verify|verification|regression|coverage)\b/.test(lower) ? "test" : "command"],
        expectedExecutables: inferExpectedExecutables(lower),
        expectedArgs: inferExpectedArgs(lower),
        mustNot: [],
        source: "deterministic_fallback",
      }],
    };
  }

  if (/\bfix\b/.test(lower)) {
    return {
      objective: request,
      criteria: [{
        id: "fix-primary",
        kind: "fix",
        statement: "Requested bug fix is implemented without regressing the described behavior",
        targets: inferTargets(lower),
        evidence: ["diff", /\b(tests?|verify|verification|ci)\b/.test(lower) ? "test" : "command"],
        expectedExecutables: inferExpectedExecutables(lower),
        expectedArgs: inferExpectedArgs(lower),
        mustNot: [],
        source: "deterministic_fallback",
      }],
    };
  }

  if (/\b(add|build|create|implement|update|remove|migrate)\b/.test(lower)) {
    const criteria: TaskCriterion[] = [{
      id: "build-primary",
      kind: "build",
      statement: "Requested code change is implemented in the relevant files",
      targets: inferTargets(lower),
      evidence: ["diff"],
      expectedExecutables: [],
      expectedArgs: inferExpectedArgs(lower),
      mustNot: inferMustNot(lower),
      source: "deterministic_fallback",
    }];

    if (/\b(tests?|verify|verification|regression|coverage)\b/.test(lower)) {
      criteria.push({
        id: "build-tests",
        kind: "build",
        statement: "Relevant tests or verification commands pass",
        targets: inferTargets(lower),
        evidence: ["test"],
        expectedExecutables: inferExpectedExecutables(lower),
        expectedArgs: inferExpectedArgs(lower),
        mustNot: [],
        source: "deterministic_fallback",
      });
    }

    if (/\b(docs?|readme|adr|plan)\b/.test(lower)) {
      criteria.push({
        id: "build-docs",
        kind: "build",
        statement: "Requested documentation is updated",
        targets: inferTargets(lower),
        // A doc update is a file edit → `diff`, which the runtime emits.
        // (Was `manual`, which the runtime agent cannot produce, so it looped.)
        evidence: ["diff"],
        expectedExecutables: [],
        expectedArgs: [],
        mustNot: [],
        source: "deterministic_fallback",
      });
    }

    return {
      objective: request,
      criteria,
    };
  }

  return {
    objective: request,
    criteria: [{
      id: "manual-primary",
      kind: "manual",
      statement: "Task outcome is explicitly demonstrated",
      targets: [],
      // Advisory: the catch-all bucket (no build/fix/test verb matched) covers
      // conversational and demonstration prompts whose outcome the runtime agent
      // cannot self-certify. Never gate it — that loops arbitrary prompts.
      evidence: ["manual"],
      expectedExecutables: [],
      expectedArgs: [],
      mustNot: [],
      source: "deterministic_fallback",
      verificationMode: "advisory",
    }],
  };
}

function inferExpectedExecutables(lower: string): string[] {
  if (/\b(tests?|verify|verification|regression|coverage|policy)\b/.test(lower)) {
    return ["vitest", "bun test", "pytest", "jest"];
  }
  // Audits/investigations are open-ended — there is no single "correct"
  // executable, and `normalizeExecutable` never emits the literal "bash"
  // (it returns the real program: git/rg/bun/…). Constraining to ["bash"] made
  // every command fail the exact-match check. Accept any command instead.
  return [];
}

function inferExpectedArgs(lower: string): string[] {
  if (/\bauth\b/.test(lower)) return ["auth"];
  if (/\bbilling\b/.test(lower)) return ["billing"];
  if (/\bsession\b/.test(lower)) return ["session"];
  return [];
}

function inferTargets(lower: string): string[] {
  if (/\bauth\b/.test(lower)) return ["src/auth", "tests/auth"];
  if (/\bbilling\b/.test(lower)) return ["src/billing", "tests/billing"];
  if (/\bsession\b/.test(lower)) return ["src/session", "tests/session"];
  return [];
}

function inferMustNot(lower: string): string[] {
  if (/\btoken\b/.test(lower) || /\bauth\b/.test(lower)) {
    return ["log session tokens"];
  }
  return [];
}
