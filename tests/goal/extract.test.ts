import { describe, expect, it } from "vitest";
import { readAborted, readTerminalFailure, readWillRetry } from "../../src/goal/extract";

const user = (text: string) => ({ role: "user", content: text, timestamp: 1 });
const toolResult = (toolName: string, text: string, isError = false) => ({
  role: "toolResult", toolCallId: "t1", toolName,
  content: [{ type: "text", text }], isError, timestamp: 3,
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

  it("returns false for normal or malformed turns", () => {
    expect(readAborted({ messages: [user("go"), stopped("stop")] })).toBe(false);
    expect(readAborted({ messages: [] })).toBe(false);
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

describe("readTerminalFailure", () => {
  it("detects a parent model error but not an abort or ordinary stop", () => {
    expect(readTerminalFailure({ messages: [{ role: "assistant", stopReason: "error" }] })).toBe(true);
    expect(readTerminalFailure({ messages: [{ role: "assistant", stopReason: "aborted" }] })).toBe(false);
    expect(readTerminalFailure({ messages: [{ role: "assistant", stopReason: "stop" }] })).toBe(false);
  });
});
