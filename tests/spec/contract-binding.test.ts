import { describe, expect, it } from "vitest";
import { verifyCriteria } from "../../src/spec/verification";
import { evidenceFromToolResult } from "../../src/spec/evidence";
import type { FormalSpec } from "../../src/spec/types";
import type { EvidenceRecord } from "../../src/spec/claims";

function makeContractSpec(): FormalSpec {
  return {
    id: "spec-contract-bind",
    tier: "ambient",
    status: "active",
    approvalStatus: "not_required",
    goal: "Fix auth regression",
    taskContract: {
      objective: "Fix auth regression",
      criteria: [{
        id: "auth-regression",
        kind: "fix",
        statement: "Expired sessions are rejected without changing valid login behavior",
        targets: ["src/auth", "tests/auth"],
        evidence: ["diff", "test"],
        expectedExecutables: ["vitest"],
        expectedArgs: ["auth"],
        mustNot: ["log session tokens"],
        source: "deterministic_fallback",
      }],
    },
    allowedCapabilities: ["read", "edit"],
    constraints: [],
    acceptanceCriteria: [{
      id: "auth-regression",
      statement: "Expired sessions are rejected without changing valid login behavior",
      evidenceRequired: ["diff", "test"],
    }],
    targetFiles: ["src/auth", "tests/auth"],
    risks: [],
    createdAt: 1,
  };
}

describe("contract-bound evidence", () => {
  it("rejects an unrelated diff even when it is successful", () => {
    const spec = makeContractSpec();
    const evidence: EvidenceRecord[] = [
      { kind: "diff", paths: ["src/billing/index.ts"], base: "abc", patchHash: "hash", passed: true },
      { kind: "test", runner: "vitest", normalizedExecutable: "vitest", args: ["run", "tests/auth"], exitCode: 0, passed: true },
    ];

    const [result] = verifyCriteria(spec, evidence);
    expect(result?.passed).toBe(false);
    expect(result?.missingEvidence).toContain("diff");
  });

  it("rejects unrelated successful commands like git grep vitest", () => {
    const spec = makeContractSpec();
    const evidence: EvidenceRecord[] = [
      { kind: "diff", paths: ["src/auth/session.ts"], base: "abc", patchHash: "hash", passed: true },
      { kind: "command", family: "grep", normalizedExecutable: "git grep", argv: ["git", "grep", "vitest"], exitCode: 0, passed: true },
    ];

    const [result] = verifyCriteria(spec, evidence);
    expect(result?.passed).toBe(false);
    expect(result?.missingEvidence).toContain("test");
  });

  it("rejects unrelated successful tests that do not target the contract surface", () => {
    const spec = makeContractSpec();
    const evidence: EvidenceRecord[] = [
      { kind: "diff", paths: ["src/auth/session.ts"], base: "abc", patchHash: "hash", passed: true },
      { kind: "test", runner: "vitest", normalizedExecutable: "vitest", args: ["run", "tests/billing"], exitCode: 0, passed: true },
    ];

    const [result] = verifyCriteria(spec, evidence);
    expect(result?.passed).toBe(false);
    expect(result?.missingEvidence).toContain("test");
  });

  it("requires explicit manual scope instead of any successful manual claim", () => {
    const spec = {
      ...makeContractSpec(),
      taskContract: {
        objective: "Audit auth regression manually",
        criteria: [{
          id: "auth-manual",
          kind: "audit",
          statement: "Manual auth audit is explicitly demonstrated",
          targets: ["src/auth"],
          evidence: ["manual"],
          expectedExecutables: [],
          expectedArgs: [],
          mustNot: [],
          source: "deterministic_fallback",
        }],
      },
      acceptanceCriteria: [{ id: "auth-manual", statement: "Manual auth audit is explicitly demonstrated", evidenceRequired: ["manual"] }],
    } satisfies FormalSpec;

    const evidence: EvidenceRecord[] = [
      { kind: "manual", actor: "user", claim: "looks good", scope: ["src/billing"], passed: true },
    ];

    const [result] = verifyCriteria(spec, evidence);
    expect(result?.passed).toBe(false);
    expect(result?.missingEvidence).toContain("manual");
  });

  it("rejects unrelated successful commands like printf test even when they contain keyword-like args", () => {
    const spec = {
      ...makeContractSpec(),
      taskContract: {
        objective: "Investigate auth issue",
        criteria: [{
          id: "auth-investigate",
          kind: "investigate",
          statement: "Auth investigation is evidenced by relevant command output",
          targets: ["src/auth"],
          evidence: ["command"],
          expectedExecutables: ["bash"],
          expectedArgs: ["auth"],
          mustNot: [],
          source: "deterministic_fallback",
        }],
      },
      acceptanceCriteria: [{ id: "auth-investigate", statement: "Auth investigation is evidenced by relevant command output", evidenceRequired: ["command"] }],
    } satisfies FormalSpec;

    const evidence: EvidenceRecord[] = [
      { kind: "command", family: "shell", normalizedExecutable: "printf", argv: ["printf", "test"], exitCode: 0, passed: true },
    ];

    const [result] = verifyCriteria(spec, evidence);
    expect(result?.passed).toBe(false);
    expect(result?.missingEvidence).toContain("command");
  });

  it("requires exact expected args instead of substring matches", () => {
    const spec = {
      ...makeContractSpec(),
      taskContract: {
        objective: "Investigate auth issue",
        criteria: [{
          id: "auth-investigate",
          kind: "investigate",
          statement: "Auth investigation is evidenced by relevant command output",
          targets: ["src/auth"],
          evidence: ["command"],
          expectedExecutables: ["bash"],
          expectedArgs: ["auth"],
          mustNot: [],
          source: "deterministic_fallback",
        }],
      },
      acceptanceCriteria: [{ id: "auth-investigate", statement: "Auth investigation is evidenced by relevant command output", evidenceRequired: ["command"] }],
    } satisfies FormalSpec;

    const evidence: EvidenceRecord[] = [
      { kind: "command", family: "shell", normalizedExecutable: "bash", argv: ["bash", "-lc", "printf authz"], exitCode: 0, passed: true },
    ];

    const [result] = verifyCriteria(spec, evidence);
    expect(result?.passed).toBe(false);
    expect(result?.missingEvidence).toContain("command");
  });

  it("normalizes command executables and rejects git grep as unrelated command evidence", () => {
    const record = evidenceFromToolResult({
      toolName: "bash",
      input: { command: "git grep vitest" },
      isError: false,
    });

    expect(record).toMatchObject({ kind: "command", normalizedExecutable: "git grep" });

    const spec = {
      ...makeContractSpec(),
      taskContract: {
        objective: "Investigate auth issue",
        criteria: [{
          id: "auth-investigate",
          kind: "investigate",
          statement: "Auth investigation is evidenced by relevant command output",
          targets: ["src/auth"],
          evidence: ["command"],
          expectedExecutables: ["bash"],
          expectedArgs: ["auth"],
          mustNot: [],
          source: "deterministic_fallback",
        }],
      },
      acceptanceCriteria: [{ id: "auth-investigate", statement: "Auth investigation is evidenced by relevant command output", evidenceRequired: ["command"] }],
    } satisfies FormalSpec;

    const [result] = verifyCriteria(spec, [record as EvidenceRecord]);
    expect(result?.passed).toBe(false);
    expect(result?.missingEvidence).toContain("command");
  });

  it("fails when forbidden evidence is present", () => {
    const spec = {
      ...makeContractSpec(),
      taskContract: {
        objective: "Fix auth regression",
        criteria: [{
          id: "auth-regression",
          kind: "fix",
          statement: "Expired sessions are rejected without changing valid login behavior",
          targets: ["src/auth", "tests/auth"],
          evidence: ["diff", "test"],
          expectedExecutables: ["vitest"],
          expectedArgs: ["auth"],
          mustNot: ["log session tokens"],
          source: "deterministic_fallback",
        }],
      },
      acceptanceCriteria: [{ id: "auth-regression", statement: "Expired sessions are rejected without changing valid login behavior", evidenceRequired: ["diff", "test"] }],
    } satisfies FormalSpec;

    const evidence: EvidenceRecord[] = [
      { kind: "diff", paths: ["src/auth/session.ts"], base: "abc", patchHash: "hash", passed: true },
      { kind: "test", runner: "vitest", normalizedExecutable: "vitest", args: ["run", "auth", "--", "log session tokens"], exitCode: 0, passed: true },
    ];

    const [result] = verifyCriteria(spec, evidence);
    expect(result?.passed).toBe(false);
    expect(result?.missingEvidence).toContain("mustNot");
  });
});
