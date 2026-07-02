import { describe, expect, it } from "vitest";
import { buildJuryPrompt } from "../../src/review/jury";

describe("buildJuryPrompt", () => {
  it("dispatches the critic panel in parallel plus an always-on devil's advocate", () => {
    const prompt = buildJuryPrompt();

    expect(prompt).toMatch(/parallel/i);
    expect(prompt).toContain("reviewer-correctness");
    expect(prompt).toContain("reviewer-security");
    expect(prompt).toContain("reviewer-tests");
    expect(prompt).toContain("oracle");
    expect(prompt.toLowerCase()).toContain("even if");
    expect(prompt.toLowerCase()).toContain("synthesis");
  });
});
