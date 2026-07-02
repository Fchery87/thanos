import { describe, expect, it } from "vitest";
import { buildEvaluatorPrompt } from "../../src/spec/evaluator";

describe("buildEvaluatorPrompt", () => {
  it("asks the evaluator to grade evidence against criteria from a fresh context", () => {
    const prompt = buildEvaluatorPrompt({
      goal: "Add pagination",
      criteria: [{ id: "c1", statement: "Tests pass", evidenceRequired: ["test"] }],
    });

    expect(prompt).toContain("evaluator");
    expect(prompt).toContain("fresh context");
    expect(prompt).toContain("Tests pass");
    expect(prompt).toMatch(/PASS|NEEDS_WORK/);
  });
});
