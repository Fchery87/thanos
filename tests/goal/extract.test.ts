import { describe, expect, it } from "vitest";
import { extractLastTurn, extractLastTurnFromBranch, readAborted, readWillRetry } from "../../src/goal/extract";

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

  it("does not throw on non-array (undefined) input", () => {
    expect(extractLastTurn(undefined as never)).toEqual({ lastAssistantText: "", toolResultsText: "" });
  });
});

describe("extractLastTurnFromBranch", () => {
  const entry = (message: unknown) => ({ type: "message", message });

  it("decodes branch entries → messages and extracts the last turn", () => {
    const out = extractLastTurnFromBranch([
      entry(user("go")), entry(assistant("ran it")), entry(toolResult("bash", "exit 0")),
    ]);
    expect(out.lastAssistantText).toBe("ran it");
    expect(out.toolResultsText).toContain("exit 0");
  });

  it("skips non-message entries and falsy messages", () => {
    const out = extractLastTurnFromBranch([
      { type: "checkpoint" }, entry(null), entry(user("go")), entry(assistant("done")),
    ]);
    expect(out.lastAssistantText).toBe("done");
  });

  it("returns empty evidence for an empty or undefined branch (fail-closed callers rely on this)", () => {
    expect(extractLastTurnFromBranch([])).toEqual({ lastAssistantText: "", toolResultsText: "" });
    expect(extractLastTurnFromBranch(undefined)).toEqual({ lastAssistantText: "", toolResultsText: "" });
  });
});

describe("readAborted", () => {
  const stopped = (stopReason: string) => ({
    role: "assistant", content: [{ type: "text", text: "…" }], stopReason, timestamp: 2,
  });

  it("detects a user abort from the last assistant message", () => {
    expect(readAborted({ messages: [user("go"), stopped("aborted")] })).toBe(true);
  });

  it("detects an abort even when tool results trail the assistant message", () => {
    expect(readAborted({
      messages: [user("go"), stopped("aborted"), toolResult("bash", "Operation aborted", true)],
    })).toBe(true);
  });

  it("returns false for a normally completed turn", () => {
    expect(readAborted({ messages: [user("go"), stopped("stop")] })).toBe(false);
    expect(readAborted({ messages: [user("go"), stopped("toolUse"), stopped("stop")] })).toBe(false);
  });

  it("returns false with no assistant message, empty messages, or malformed events", () => {
    expect(readAborted({ messages: [user("go")] })).toBe(false);
    expect(readAborted({ messages: [] })).toBe(false);
    expect(readAborted({})).toBe(false);
    expect(readAborted(undefined)).toBe(false);
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
