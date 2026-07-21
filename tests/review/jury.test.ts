import { describe, expect, it } from "vitest";
import { buildJuryPrompt } from "../../src/review/jury";

describe("buildJuryPrompt", () => {
  it("describes one child task and one result contract", () => {
    const prompt = buildJuryPrompt();

    expect(prompt).toContain("one child task");
    expect(prompt).toContain("one result contract");
    expect(prompt).toContain("reviewer-correctness");
    expect(prompt).toContain("reviewer-security");
    expect(prompt).toContain("reviewer-tests");
    expect(prompt).toContain("oracle");
    expect(prompt.toLowerCase()).toContain("devil's advocate");
    expect(prompt.toLowerCase()).toContain("verdict");
  });
});
