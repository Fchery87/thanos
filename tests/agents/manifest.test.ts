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
      timeoutMs: 1200000,
      systemPromptMode: "replace",
      inheritProjectContext: true,
      defaultContext: "fork",
      defaultReads: ["context.md", "plan.md"],
      defaultProgress: true,
    })).not.toThrow();
  });

  it("rejects the retired maxExecutionTimeMs key outright", () => {
    expect(() =>
      validateManifest("explore", { maxExecutionTimeMs: 600000 }),
    ).toThrow(/maxExecutionTimeMs is retired; use timeoutMs/);
  });

  it("rejects the retired maxTurns key outright", () => {
    expect(() =>
      validateManifest("explore", { maxTurns: 20 }),
    ).toThrow(/maxTurns is retired; use turnBudget/);
  });

  it("requires timeoutMs to be a positive integer when present", () => {
    expect(() => validateManifest("explore", { timeoutMs: 0 })).toThrow(
      /must declare timeoutMs as a positive integer/,
    );
    expect(() => validateManifest("explore", { timeoutMs: Number.NaN })).toThrow(
      /must declare timeoutMs as a positive integer/,
    );
    expect(() => validateManifest("explore", { timeoutMs: Number.POSITIVE_INFINITY })).toThrow(
      /must declare timeoutMs as a positive integer/,
    );
    expect(() => validateManifest("explore", { timeoutMs: 1.5 })).toThrow(
      /must declare timeoutMs as a positive integer/,
    );
    expect(() => validateManifest("explore", { timeoutMs: 600000 })).not.toThrow();
  });

  it("requires turnBudget.maxTurns to be a positive integer when present", () => {
    expect(() => validateManifest("explore", { turnBudget: { maxTurns: 0 } })).toThrow(
      /must declare turnBudget\.maxTurns as a positive integer/,
    );
    expect(() => validateManifest("explore", { turnBudget: { maxTurns: 4.5 } })).toThrow(
      /must declare turnBudget\.maxTurns as a positive integer/,
    );
    expect(() => validateManifest("explore", { turnBudget: { maxTurns: 20 } })).not.toThrow();
  });

  it("requires turnBudget.graceTurns to be a non-negative integer when present", () => {
    expect(() =>
      validateManifest("explore", { turnBudget: { maxTurns: 20, graceTurns: -1 } }),
    ).toThrow(/must declare turnBudget\.graceTurns as a non-negative integer/);
    expect(() =>
      validateManifest("explore", { turnBudget: { maxTurns: 20, graceTurns: 1.5 } }),
    ).toThrow(/must declare turnBudget\.graceTurns as a non-negative integer/);
    expect(() => validateManifest("explore", { turnBudget: { maxTurns: 20, graceTurns: 0 } })).not.toThrow();
    expect(() => validateManifest("explore", { turnBudget: { maxTurns: 20, graceTurns: 2 } })).not.toThrow();
  });

  it("requires model to be a non-empty string when present", () => {
    expect(() => validateManifest("explore", { model: "" })).toThrow(
      /must declare a non-empty model/,
    );
    expect(() => validateManifest("explore", { model: "   " })).toThrow(
      /must declare a non-empty model/,
    );
    expect(() => validateManifest("explore", { model: "theclawbay/gpt-5.4-mini" })).not.toThrow();
    expect(() => validateManifest("explore", {})).not.toThrow();
  });

  it("requires fallbackModels to be a non-empty array of non-empty strings when present", () => {
    expect(() => validateManifest("explore", { fallbackModels: [] })).toThrow(
      /must declare fallbackModels as a non-empty array/,
    );
    expect(() => validateManifest("explore", { fallbackModels: [""] })).toThrow(
      /must declare every fallbackModels entry as a non-empty string/,
    );
    expect(() => validateManifest("explore", { fallbackModels: ["  "] })).toThrow(
      /must declare every fallbackModels entry as a non-empty string/,
    );
    expect(() => validateManifest("explore", { fallbackModels: [123 as unknown as string] })).toThrow(
      /must declare every fallbackModels entry as a non-empty string/,
    );
    expect(() =>
      validateManifest("explore", { fallbackModels: ["openai/gpt-5:medium", "" as string] }),
    ).toThrow(/must declare every fallbackModels entry as a non-empty string/);
    expect(() =>
      validateManifest("explore", { fallbackModels: ["openai/gpt-5:medium", "anthropic/claude-haiku-4-5:off"] }),
    ).not.toThrow();
  });
});
