import { describe, expect, it } from "vitest";
import { shouldSaveMemory, extractCorrection, formatMemoriesForInjection } from "../../src/memory/injector";
import type { MemoryRecord } from "../../src/memory/types";

describe("shouldSaveMemory", () => {
  it("detects 'don't' corrections", () => {
    expect(shouldSaveMemory("please don't use var declarations")).toBe(true);
    expect(shouldSaveMemory("don't add comments to every line")).toBe(true);
  });

  it("detects 'never' and 'avoid'", () => {
    expect(shouldSaveMemory("never use any type in TypeScript")).toBe(true);
    expect(shouldSaveMemory("avoid mocking the database in tests")).toBe(true);
  });

  it("detects 'instead' and 'prefer'", () => {
    expect(shouldSaveMemory("use bun instead of node")).toBe(true);
    expect(shouldSaveMemory("prefer const over let")).toBe(true);
  });

  it("returns false for normal prompts", () => {
    expect(shouldSaveMemory("add pagination to the user list")).toBe(false);
    expect(shouldSaveMemory("fix the failing tests")).toBe(false);
    expect(shouldSaveMemory("refactor the auth module")).toBe(false);
  });
});

describe("extractCorrection", () => {
  it("truncates long prompts to 300 chars", () => {
    const long = "a".repeat(500);
    expect(extractCorrection(long).length).toBeLessThanOrEqual(300);
  });

  it("trims whitespace", () => {
    expect(extractCorrection("  hello  ")).toBe("hello");
  });
});

describe("formatMemoriesForInjection", () => {
  const makeRecord = (correction: string): MemoryRecord => ({
    id: "test-id",
    project: "proj",
    spec_tier: "",
    capability: "",
    pattern: "",
    correction,
    timestamp: Date.now(),
  });

  it("returns null for empty memories", () => {
    expect(formatMemoriesForInjection([])).toBeNull();
  });

  it("formats memories as a system prompt prefix", () => {
    const result = formatMemoriesForInjection([
      makeRecord("don't use var"),
      makeRecord("avoid any type"),
    ]);
    expect(result).toContain("Remembered preferences");
    expect(result).toContain("don't use var");
    expect(result).toContain("avoid any type");
    expect(result).toContain("Apply these preferences");
  });

  it("caps output at 10 entries even with more records", () => {
    const records = Array.from({ length: 15 }, (_, i) => makeRecord(`rule ${i}`));
    const result = formatMemoriesForInjection(records)!;
    const lines = result.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.length).toBe(10);
  });
});
