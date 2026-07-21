import { describe, expect, it } from "vitest";
import { gradePromptCase, summarizePromptGrades } from "../../evals/prompts/graders";

describe("prompt graders", () => {
  it("flags empty cases as failed", () => {
    expect(gradePromptCase({ id: "x", family: "memory-injection", input: "   " })).toMatchObject({ ok: false });
  });

  it("summarizes passed and failed counts", () => {
    expect(summarizePromptGrades([
      { id: "a", family: "project-description-injection", input: "one" },
      { id: "b", family: "memory-injection", input: "" },
    ])).toEqual({ total: 2, passed: 1, failed: 1 });
  });
});
