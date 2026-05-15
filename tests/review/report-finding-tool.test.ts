import { describe, expect, it, vi } from "vitest";
import register from "../../src/index";

function fakePi(tools: Map<string, any>) {
  return {
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => false),
    on: vi.fn(),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
  } as any;
}

describe("report_finding tool", () => {
  it("registers only for reviewer subagents", () => {
    const mainTools = new Map<string, any>();
    register(fakePi(mainTools));
    expect(mainTools.has("report_finding")).toBe(false);

    const reviewerTools = new Map<string, any>();
    const previous = process.env.HARNESS_SUBAGENT;
    process.env.HARNESS_SUBAGENT = "reviewer";
    try {
      register(fakePi(reviewerTools));
      expect(reviewerTools.has("report_finding")).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.HARNESS_SUBAGENT;
      else process.env.HARNESS_SUBAGENT = previous;
    }
  });

  it("returns aggregate verdict after a finding is reported", async () => {
    const reviewerTools = new Map<string, any>();
    const previous = process.env.HARNESS_SUBAGENT;
    process.env.HARNESS_SUBAGENT = "reviewer";
    try {
      register(fakePi(reviewerTools));
      const result = await reviewerTools.get("report_finding").execute("rf-1", {
        priority: "P1",
        summary: "Policy bypass",
        rationale: "The tool skips governance checks.",
      }, undefined, undefined, { hasUI: true, ui: {} });

      expect(JSON.parse(result.content[0].text)).toMatchObject({
        verdict: "request-changes",
        findings: [{ priority: "P1", summary: "Policy bypass" }],
      });
    } finally {
      if (previous === undefined) delete process.env.HARNESS_SUBAGENT;
      else process.env.HARNESS_SUBAGENT = previous;
    }
  });
});
