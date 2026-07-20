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
const TEST: EvidenceRecord = { kind: "test", runner: "vitest", args: ["run"], exitCode: 0, passed: true };
const CMD: EvidenceRecord = { kind: "command", family: "", argv: ["ls"], exitCode: 0, passed: true };
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

  it("returns a single failed result when acceptanceCriteria is empty", () => {
    const emptySpec: FormalSpec = {
      id: "spec-empty",
      tier: "ambient",
      status: "active",
      approvalStatus: "not_required",
      goal: "Some goal",
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
