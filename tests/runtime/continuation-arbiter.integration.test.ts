import { describe, expect, it } from "vitest";
import { ContinuationArbiter } from "../../src/runtime/continuation-arbiter";

describe("ContinuationArbiter", () => {
  it("prefers the active goal over a failing spec gate", () => {
    const arbiter = new ContinuationArbiter();
    const result = arbiter.decide({
      results: [{ criterion: { id: "c1", statement: "tests pass", evidenceRequired: ["test"] }, passed: false, evidence: [], missingEvidence: ["test"] }],
      gateAttempts: 0,
      isSubagent: false,
      gateEnabled: true,
      goalActive: true,
      aborted: false,
      hasUI: true,
      turnCount: 0,
      maxTurns: 100,
    });

    expect(result.decision).toBe("continue_goal");
    expect(result.selectedDriver).toBe("goal");
    expect(result.rejectedDrivers).toContain("spec");
  });
});
