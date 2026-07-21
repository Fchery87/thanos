import { describe, expect, it } from "vitest";
import { verifyCriteria } from "../../src/spec/verification";
import { confirmGoalCompletion } from "../../src/goal/confirm";
import type { FormalSpec } from "../../src/spec/types";
import type { EvidenceRecord } from "../../src/spec/claims";

describe("deterministic-first verification", () => {
  it("does not let manual semantic evidence override a failing required command", () => {
    const spec: FormalSpec = {
      id: "spec-det-1",
      tier: "ambient",
      status: "active",
      approvalStatus: "not_required",
      goal: "Run the required verification command",
      taskContract: {
        objective: "Run the required verification command",
        criteria: [{ id: "cmd", kind: "manual", statement: "Required verification command passes", targets: [], evidence: ["command"], expectedExecutables: [], expectedArgs: [], mustNot: [], source: "deterministic_fallback" }],
      },
      allowedCapabilities: ["read"],
      constraints: [],
      acceptanceCriteria: [{
        id: "cmd",
        statement: "Required verification command passes",
        evidenceRequired: ["command"],
      }],
      targetFiles: [],
      risks: [],
      createdAt: 1,
    };

    const evidence: EvidenceRecord[] = [
      { kind: "command", family: "test", normalizedExecutable: "bun", argv: ["bun", "run", "test"], exitCode: 1, passed: false },
      { kind: "manual", actor: "evaluator", claim: "MET", passed: true },
    ];

    const [result] = verifyCriteria(spec, evidence);
    expect(result?.passed).toBe(false);
    expect(result?.missingEvidence).toContain("command (failed)");
  });

  it("fails closed before semantic evaluation when deterministic command evidence failed", async () => {
    const verdict = await confirmGoalCompletion(
      {
        condition: "required command passes",
        summary: "I think it is done",
        evidence: {
          lastAssistantText: "done",
          toolResultsText: "[bash (ERROR)]\nbun run test\nexit 1",
        },
      },
      async () => ({ met: true, reason: "model said MET" }),
      async () => ({ met: true, reason: "fallback said MET" }),
    );

    expect(verdict.met).toBe(false);
    expect(verdict.reason).toMatch(/required command failed/i);
  });

  it("does not fail closed on benign zero-error output", async () => {
    const verdict = await confirmGoalCompletion(
      {
        condition: "required command passes",
        summary: "I think it is done",
        evidence: {
          lastAssistantText: "done",
          toolResultsText: "0 errors, 0 failures",
        },
      },
      async () => ({ met: true, reason: "model said MET" }),
      async () => ({ met: true, reason: "fallback said MET" }),
    );

    expect(verdict.met).toBe(true);
  });
});
