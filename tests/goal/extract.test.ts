import { describe, expect, it } from "vitest";
import { extractLastTurn, readWillRetry } from "../../src/goal/extract";

const user = (text: string) => ({ role: "user", content: text, timestamp: 1 });
const assistant = (text: string) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  timestamp: 2,
});
const toolResult = (toolName: string, text: string, isError = false) => ({
  role: "toolResult", toolCallId: "t1", toolName,
  content: [{ type: "text", text }], isError, timestamp: 3,
});

describe("extractLastTurn", () => {
  it("collects assistant text and tool results after the last user message", () => {
    const out = extractLastTurn([
      user("old prompt"), assistant("old work"), toolResult("bash", "old output"),
      user("continue"), assistant("ran the tests"), toolResult("bash", "4 passed, 0 failed"),
    ] as never[]);
    expect(out.lastAssistantText).toBe("ran the tests");
    expect(out.toolResultsText).toContain("4 passed, 0 failed");
    expect(out.toolResultsText).toContain("bash");
    expect(out.toolResultsText).not.toContain("old output");
  });

  it("marks errored tool results", () => {
    const out = extractLastTurn([
      user("go"), assistant("trying"), toolResult("bash", "boom", true),
    ] as never[]);
    expect(out.toolResultsText).toMatch(/error/i);
  });

  it("clips oversized tool output, keeping the tail", () => {
    const out = extractLastTurn([
      user("go"), assistant("x"), toolResult("bash", `${"a".repeat(20000)}TAIL`),
    ] as never[]);
    expect(out.toolResultsText.length).toBeLessThanOrEqual(9000);
    expect(out.toolResultsText).toContain("TAIL");
  });

  it("handles an empty/absent turn safely", () => {
    expect(extractLastTurn([] as never[])).toEqual({ lastAssistantText: "", toolResultsText: "" });
  });
});

describe("readWillRetry", () => {
  it("reads a boolean willRetry when present, defaults false", () => {
    expect(readWillRetry({ willRetry: true })).toBe(true);
    expect(readWillRetry({ willRetry: false })).toBe(false);
    expect(readWillRetry({})).toBe(false);
    expect(readWillRetry(undefined)).toBe(false);
  });
});
