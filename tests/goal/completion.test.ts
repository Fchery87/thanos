import { describe, expect, it } from "vitest";
import { decideCompletionClaim } from "../../src/goal/completion";
import type { VerificationResult } from "../../src/spec/verification";

function result(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    criterion: {
      id: "criterion",
      statement: "operator requirement",
      evidenceRequired: ["test"],
      source: "semantic_extraction",
    },
    passed: true,
    evidence: ["vitest (exit 0)"],
    missingEvidence: [],
    source: "semantic_extraction",
    ...overrides,
  };
}

describe("decideCompletionClaim", () => {
  it("accepts only when every operator-derived criterion passed", () => {
    expect(decideCompletionClaim("verified", [result()])).toEqual({
      met: true,
      reason: "verified",
    });
  });

  it("rejects a claim with no verifiable Work Contract", () => {
    expect(decideCompletionClaim("done", [])).toMatchObject({
      met: false,
      reason: expect.stringContaining("no active Work Contract"),
    });
  });

  it("rejects unmet operator-derived criteria", () => {
    expect(decideCompletionClaim("done", [
      result({ passed: false, missingEvidence: ["test"] }),
    ])).toMatchObject({
      met: false,
      reason: expect.stringContaining("operator requirement"),
    });
  });

  it("does not let deterministic fallback templates accept the operator task", () => {
    expect(decideCompletionClaim("done", [
      result({
        source: "deterministic_fallback",
        criterion: {
          id: "fallback",
          statement: "generic template",
          evidenceRequired: ["test"],
          source: "deterministic_fallback",
        },
      }),
    ])).toMatchObject({
      met: false,
      reason: expect.stringContaining("operator-derived"),
    });
  });

  it("accepts a passing deterministic contract after the operator approved that exact contract", () => {
    expect(decideCompletionClaim("approved and verified", [
      result({
        source: "deterministic_fallback",
        criterion: {
          id: "fallback",
          statement: "operator-approved template",
          evidenceRequired: ["test"],
          source: "deterministic_fallback",
        },
      }),
    ], { contractApproved: true })).toEqual({
      met: true,
      reason: "approved and verified",
    });
  });

  it("does not silently accept advisory criteria without qualitative judgment", () => {
    expect(decideCompletionClaim("done", [
      result({ advisory: true }),
    ])).toMatchObject({
      met: false,
      reason: expect.stringContaining("advisory"),
    });
  });
});
