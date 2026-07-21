import { describe, expect, it } from "vitest";
import { buildWaveWorkerPrompt } from "../../src/waves/prompt";
import type { WaveSlice } from "../../src/waves/types";

describe("buildWaveWorkerPrompt", () => {
  it("builds a self-contained read-slice prompt with handoff rules", () => {
    const slice: WaveSlice = {
      id: "docs",
      agent: "explore",
      goal: "Audit documentation gaps",
      paths: ["docs", "README.md"],
      mode: "read",
    };

    const prompt = buildWaveWorkerPrompt(slice, "Strengthen the harness");

    expect(prompt).toContain("Strengthen the harness");
    expect(prompt).toContain("Audit documentation gaps");
    expect(prompt).toContain("docs");
    expect(prompt).toContain("README.md");
    expect(prompt).toContain("Scope boundaries");
    expect(prompt).toContain("Status: success | partial | blocked");
    expect(prompt).toContain("Confidence: high | medium | low");
    expect(prompt.toLowerCase()).toContain("cite-or-drop");
    expect(prompt.toLowerCase()).toContain("return only the handoff");
  });

  it("adds ownership constraints for write slices", () => {
    const slice: WaveSlice = {
      id: "worker",
      agent: "worker",
      goal: "Update worker prompt",
      paths: ["agent/agents/worker.md"],
      mode: "write",
    };

    const prompt = buildWaveWorkerPrompt(slice, "Standardize ledgers");

    expect(prompt).toContain("Own only these paths");
    expect(prompt).toContain("Return one handoff only");
  });
});
