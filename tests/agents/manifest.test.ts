import { describe, expect, it } from "vitest";
import { validateManifest } from "../../src/agents/manifest";

describe("validateManifest", () => {
  it("rejects unsupported delegation depth", () => {
    expect(() => validateManifest("worker", {
      tools: ["read", "write", "edit", "bash"],
      maxSubagentDepth: 1,
    })).toThrow(/unsupported maxSubagentDepth/i);
  });

  it("rejects uncatalogued frontmatter settings", () => {
    expect(() => validateManifest("worker", {
      tools: ["read", "write", "edit", "bash"],
      systemPromptMode: "append",
      inheritProjectContext: false,
      defaultContext: "fresh",
      defaultReads: ["context.md"],
      defaultProgress: false,
    })).toThrow(/systemPromptMode/i);
  });

  it("accepts the catalog-backed worker manifest shape", () => {
    expect(() => validateManifest("worker", {
      tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
      maxExecutionTimeMs: 1200000,
      systemPromptMode: "replace",
      inheritProjectContext: true,
      defaultContext: "fork",
      defaultReads: ["context.md", "plan.md"],
      defaultProgress: true,
    })).not.toThrow();
  });
});
