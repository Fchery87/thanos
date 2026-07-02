import { describe, expect, it } from "vitest";
import { verifyWaveHandoffs, type WaveHandoff } from "../../src/waves/verify";

const handoff = (overrides: Partial<WaveHandoff> = {}): WaveHandoff => ({
  status: "success",
  slice: "docs",
  keyFindings: ["Found docs gap"],
  evidence: ["README.md section Track and verify"],
  openQuestions: [],
  suggestedFollowUps: [],
  confidence: "high",
  ...overrides,
});

describe("verifyWaveHandoffs", () => {
  it("fails handoffs with missing evidence", () => {
    const result = verifyWaveHandoffs([handoff({ evidence: [] })]);

    expect(result.passed).toBe(false);
    expect(result.requiresEscalation).toBe(false);
    expect(result.issues.join("\n")).toMatch(/evidence/i);
  });

  it("requires escalation for low-confidence handoffs", () => {
    const result = verifyWaveHandoffs([handoff({ confidence: "low" })]);

    expect(result.passed).toBe(false);
    expect(result.requiresEscalation).toBe(true);
    expect(result.issues.join("\n")).toMatch(/confidence/i);
  });

  it("requires synthesis review for mixed statuses", () => {
    const result = verifyWaveHandoffs([
      handoff({ status: "success", slice: "docs" }),
      handoff({ status: "blocked", slice: "tests", openQuestions: ["Need decision"] }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.requiresSynthesisReview).toBe(true);
  });

  it("passes success handoffs with evidence", () => {
    const result = verifyWaveHandoffs([handoff(), handoff({ slice: "tests" })]);

    expect(result).toMatchObject({
      passed: true,
      requiresEscalation: false,
      requiresSynthesisReview: false,
      issues: [],
    });
  });
});
