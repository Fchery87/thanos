import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("prompt budget baseline", () => {
  it("has representative prompt fixtures", async () => {
    const text = await readFile(new URL("../fixtures/prompts/representative-requests.json", import.meta.url), "utf8");
    const cases = JSON.parse(text) as string[];
    expect(cases).toHaveLength(10);
  });

  it("records a deterministic prompt benchmark artifact", async () => {
    const text = await readFile(new URL("../../.harness/benchmark-results.json", import.meta.url), "utf8");
    const artifact = JSON.parse(text) as {
      generatedAt: string;
      results: Array<{ name: string; chars?: number; estimatedTokens?: number; score?: number }>;
    };
    expect(Array.isArray(artifact.results)).toBe(true);
    expect(artifact.results.length).toBeGreaterThan(0);
    expect(artifact.generatedAt).toBe("deterministic");
    expect(artifact.results.some((entry) => entry.name === "contract extraction accuracy")).toBe(true);
    expect(artifact.results.some((entry) => entry.name === "subagent contract adherence")).toBe(true);
  });
});
