import { describe, expect, it } from "vitest";
import { buildContinuationPrompt, GATE_MAX_ATTEMPTS, shouldReinject } from "../../src/spec/gate";
import type { VerificationResult } from "../../src/spec/verification";

const crit = (passed: boolean): VerificationResult => ({
  criterion: { id: "c1", statement: "tests pass", evidenceRequired: ["test"] },
  passed,
  evidence: [],
});

describe("shouldReinject", () => {
  it("re-injects when a criterion fails and budget remains", () => {
    expect(shouldReinject({ results: [crit(false)], attempts: 0, isSubagent: false, enabled: true, goalActive: false })).toBe(true);
  });

  it("does not re-inject when all criteria pass", () => {
    expect(shouldReinject({ results: [crit(true)], attempts: 0, isSubagent: false, enabled: true, goalActive: false })).toBe(false);
  });

  it("does not re-inject in a subagent", () => {
    expect(shouldReinject({ results: [crit(false)], attempts: 0, isSubagent: true, enabled: true, goalActive: false })).toBe(false);
  });

  it("stops once the attempt budget is exhausted", () => {
    expect(shouldReinject({ results: [crit(false)], attempts: GATE_MAX_ATTEMPTS, isSubagent: false, enabled: true, goalActive: false })).toBe(false);
  });

  it("is a no-op when disabled", () => {
    expect(shouldReinject({ results: [crit(false)], attempts: 0, isSubagent: false, enabled: false, goalActive: false })).toBe(false);
  });

  it("does not re-inject with no results (instant tier / no spec)", () => {
    expect(shouldReinject({ results: [], attempts: 0, isSubagent: false, enabled: true, goalActive: false })).toBe(false);
  });

  it("does not re-inject while a goal is active (goal loop is the only driver)", () => {
    expect(shouldReinject({ results: [crit(false)], attempts: 0, isSubagent: false, enabled: true, goalActive: true })).toBe(false);
  });
});

describe("buildContinuationPrompt", () => {
  it("lists only the unmet criteria and carries the sentinel", () => {
    const prompt = buildContinuationPrompt([crit(false), {
      criterion: { id: "c2", statement: "docs updated", evidenceRequired: ["diff"] },
      passed: true,
      evidence: ["diff observed"],
    }], 1);

    expect(prompt).toContain("[harness:verify-continue]");
    expect(prompt).toContain("tests pass");
    expect(prompt).not.toContain("docs updated");
    expect(prompt).toContain("attempt 2");
    expect(prompt.toLowerCase()).toContain("do not stop");
  });
});
