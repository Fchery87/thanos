import { describe, expect, it } from "vitest";
import { verifyCriteria } from "../../src/spec/verification";
import type { FormalSpec } from "../../src/spec/types";
import type { EvidenceRecord } from "../../src/spec/claims";

function makeSpec(): FormalSpec {
  return {
    id: "spec-1",
    tier: "ambient",
    status: "active",
    approvalStatus: "not_required",
    goal: "Build the billing flow",
    taskContract: {
      objective: "Build the billing flow",
      criteria: [{ id: "manual-primary", kind: "manual", statement: "Task completed", targets: [], evidence: ["manual"], expectedExecutables: [], expectedArgs: [], mustNot: [], source: "deterministic_fallback" }],
    },
    allowedCapabilities: ["read", "edit"],
    constraints: [],
    acceptanceCriteria: [
      { id: "diff-test", statement: "Diff and tests exist", evidenceRequired: ["diff", "test"] },
      { id: "manual", statement: "Task completed", evidenceRequired: ["manual"] },
    ],
    targetFiles: [],
    risks: [],
    createdAt: 1,
  };
}

const DIFF: EvidenceRecord = { kind: "diff", paths: ["src/index.ts"], base: "abc", patchHash: "hash123", passed: true };
const DIFF_FAIL: EvidenceRecord = { kind: "diff", paths: ["src/index.ts"], base: "abc", patchHash: "hash123", passed: false };
const TEST: EvidenceRecord = { kind: "test", runner: "vitest", normalizedExecutable: "vitest", args: ["run"], exitCode: 0, passed: true };
const MANUAL: EvidenceRecord = { kind: "manual", actor: "user", claim: "looks good", passed: true };
const MANUAL_FAIL: EvidenceRecord = { kind: "manual", actor: "user", claim: "nope", passed: false };

describe("verifyCriteria", () => {
  it("ignores failed evidence", () => {
    const results = verifyCriteria(makeSpec(), [DIFF_FAIL]);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.evidence).toEqual([]);
  });

  it("requires every evidence type for the criterion", () => {
    const results = verifyCriteria(makeSpec(), [DIFF, TEST, MANUAL]);

    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.evidence).toHaveLength(2);
    expect(results[0]?.evidence[0]).toContain("src/index.ts");
    expect(results[0]?.evidence[1]).toContain("vitest");
  });

  it("does not let extra evidence hurt matching", () => {
    const results = verifyCriteria(makeSpec(), [DIFF, TEST, MANUAL]);

    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.evidence).toHaveLength(2);
  });

  it("only includes passed matching evidence in summaries", () => {
    const results = verifyCriteria(makeSpec(), [MANUAL, MANUAL_FAIL, DIFF]);

    expect(results[1]?.passed).toBe(true);
    expect(results[1]?.evidence).toHaveLength(1);
    expect(results[1]?.evidence[0]).toContain("manual");
  });

  it("reports missing evidence requirements", () => {
    const results = verifyCriteria(makeSpec(), [DIFF]);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.missingEvidence).toContain("test");
  });

  it("records deterministic failure reasons before any manual semantic evidence", () => {
    const results = verifyCriteria(makeSpec(), [
      DIFF,
      { kind: "test", runner: "vitest", normalizedExecutable: "vitest", args: ["run"], exitCode: 1, passed: false },
      MANUAL,
    ]);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.missingEvidence).toContain("test (failed)");
    expect(results[0]?.evidence).toEqual([expect.stringContaining("src/index.ts")]);
  });

  it("returns a single failed result when acceptanceCriteria is empty", () => {
    const emptySpec: FormalSpec = {
      id: "spec-empty",
      tier: "ambient",
      status: "active",
      approvalStatus: "not_required",
      goal: "Some goal",
      taskContract: {
        objective: "Some goal",
        criteria: [],
      },
      allowedCapabilities: ["read"],
      constraints: [],
      acceptanceCriteria: [],
      targetFiles: [],
      risks: [],
      createdAt: 1,
    };

    const results = verifyCriteria(emptySpec, []);

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.criterion.statement).toContain("No verifiable criteria");
  });
});

describe("mustNot scoping", () => {
  // mustNot was inert while inferMustNot emitted a single hardcoded phrase. The
  // extractor can emit real values, so it is live now — and an unscoped scan
  // over the whole turn's evidence fails a criterion because of evidence that
  // belongs to a different one.
  function specWithMustNot(): FormalSpec {
    return {
      id: "spec-mustnot",
      tier: "ambient",
      status: "active",
      approvalStatus: "not_required",
      goal: "Harden the auth flow",
      taskContract: {
        objective: "Harden the auth flow",
        criteria: [
          { id: "auth-change", kind: "secure", statement: "Auth hardening lands", targets: ["src/auth"], evidence: ["diff"], expectedExecutables: [], expectedArgs: [], mustNot: ["src/legacy"], source: "semantic_extraction" },
          { id: "docs-change", kind: "build", statement: "Docs updated", targets: ["docs"], evidence: ["diff"], expectedExecutables: [], expectedArgs: [], mustNot: [], source: "semantic_extraction" },
        ],
      },
      allowedCapabilities: ["read", "edit"],
      constraints: [],
      acceptanceCriteria: [
        { id: "auth-change", statement: "Auth hardening lands", evidenceRequired: ["diff"] },
        { id: "docs-change", statement: "Docs updated", evidenceRequired: ["diff"] },
      ],
      targetFiles: [],
      risks: [],
      createdAt: 1,
    };
  }

  it("fails a criterion whose own evidence violates its prohibition", () => {
    const results = verifyCriteria(specWithMustNot(), [
      { kind: "diff", paths: ["src/auth/login.ts", "src/legacy/shim.ts"], base: "", patchHash: "", passed: true },
    ]);

    const auth = results.find((r) => r.criterion.id === "auth-change");
    expect(auth?.passed).toBe(false);
    expect(auth?.missingEvidence).toContain("mustNot");
  });

  it("does not fail a criterion because a DIFFERENT criterion's evidence matches", () => {
    const results = verifyCriteria(specWithMustNot(), [
      { kind: "diff", paths: ["src/auth/login.ts"], base: "", patchHash: "", passed: true },
      { kind: "diff", paths: ["src/legacy/shim.ts"], base: "", patchHash: "", passed: true },
    ]);

    const auth = results.find((r) => r.criterion.id === "auth-change");
    expect(auth?.passed).toBe(true);
    expect(auth?.missingEvidence).not.toContain("mustNot");
  });

  it("passes when nothing violates the prohibition", () => {
    const results = verifyCriteria(specWithMustNot(), [
      { kind: "diff", paths: ["src/auth/login.ts"], base: "", patchHash: "", passed: true },
    ]);

    expect(results.find((r) => r.criterion.id === "auth-change")?.passed).toBe(true);
  });
});
