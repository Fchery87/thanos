import { describe, expect, it } from "vitest";
import { buildWavesCommandPrompt } from "../../src/waves/command";

describe("buildWavesCommandPrompt", () => {
  it("asks the main agent to draft, validate, fan out, verify, and synthesize a bounded wave", () => {
    const prompt = buildWavesCommandPrompt("audit the spec harness");

    expect(prompt).toContain("audit the spec harness");
    expect(prompt).toContain("draft a bounded wave plan");
    expect(prompt).toContain("validate independence");
    expect(prompt).toContain("path ownership");
    expect(prompt).toContain("subagent");
    expect(prompt).toMatch(/parallel/i);
    expect(prompt).toContain("verified handoffs");
    expect(prompt).toContain("synthesize");
  });
});
