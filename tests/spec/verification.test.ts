import { describe, expect, it } from "vitest";
import { verifyCriteria } from "../../src/spec/verification";
import type { FormalSpec } from "../../src/spec/types";

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

describe("verifyCriteria", () => {
  it("ignores failed evidence", () => {
    const results = verifyCriteria(makeSpec(), [
      { type: "diff", source: "edit", summary: "failed diff", passed: false },
    ]);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.evidence).toEqual([]);
  });

  it("requires every evidence type for the criterion", () => {
    const results = verifyCriteria(makeSpec(), [
      { type: "diff", source: "edit", summary: "diff ok", passed: true },
      { type: "test", source: "bash", summary: "test ok", passed: true },
      { type: "manual", source: "assistant", summary: "manual ok", passed: true },
    ]);

    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.evidence).toEqual(["diff ok", "test ok"]);
  });

  it("does not let extra evidence hurt matching", () => {
    const results = verifyCriteria(makeSpec(), [
      { type: "diff", source: "edit", summary: "diff ok", passed: true },
      { type: "test", source: "bash", summary: "test ok", passed: true },
      { type: "manual", source: "assistant", summary: "extra manual", passed: true },
    ]);

    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.evidence).toEqual(["diff ok", "test ok"]);
  });

  it("only includes passed matching evidence in summaries", () => {
    const results = verifyCriteria(makeSpec(), [
      { type: "manual", source: "assistant", summary: "manual ok", passed: true },
      { type: "manual", source: "assistant", summary: "manual failed", passed: false },
      { type: "diff", source: "edit", summary: "other evidence", passed: true },
    ]);

    expect(results[1]?.passed).toBe(true);
    expect(results[1]?.evidence).toEqual(["manual ok"]);
  });
});
