import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("prompt evaluation dataset", () => {
  it("has at least one JSONL case", async () => {
    const text = await readFile(new URL("../../evals/prompts/cases.jsonl", import.meta.url), "utf8");
    expect(text.trim().length).toBeGreaterThan(0);
  });
});
