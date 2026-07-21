import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { summarizePromptGrades, validatePromptFamilies } from "../../evals/prompts/graders";

describe("prompt evaluation dataset", () => {
  it("has at least one JSONL case", async () => {
    const text = await readFile(new URL("../../evals/prompts/cases.jsonl", import.meta.url), "utf8");
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("contains multiple families for the release gates", async () => {
    const text = await readFile(new URL("../../evals/prompts/cases.jsonl", import.meta.url), "utf8");
    const cases = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { family: string; input: string; id: string });
    const summary = summarizePromptGrades(cases);
    const familyCheck = validatePromptFamilies(cases, [
      "project-description-injection",
      "memory-injection",
      "goal-delimiter-and-sentinel-injection",
      "tool-output-evaluator-injection",
    ]);
    expect(new Set(cases.map((item) => item.family)).size).toBeGreaterThan(3);
    expect(summary.total).toBe(cases.length);
    expect(familyCheck.ok).toBe(true);
  });
});
