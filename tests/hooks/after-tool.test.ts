import { describe, expect, it, vi } from "vitest";

import { makeAfterToolHandler } from "../../src/hooks/after-tool";
import { SpecEngine } from "../../src/spec/engine";

describe("makeAfterToolHandler", () => {
  it("records a successful test command from a real Pi tool_result event shape", async () => {
    const spec = new SpecEngine();
    spec.generate("Add pagination with tests", "ambient");

    await makeAfterToolHandler(spec)({
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "bash",
      input: { command: "bun test tests/index.test.ts" },
      content: [{ type: "text", text: "3 pass\n" }],
      isError: false,
      details: undefined,
    });

    const testResult = spec.verify().find((result) => result.criterion.statement === "Tests written");

    expect(testResult?.passed).toBe(true);
    expect(testResult?.evidence).toContain("bun test tests/index.test.ts passed");
  });

  it("truncates oversized ctx tool results before they enter the transcript", async () => {
    const spec = new SpecEngine();
    const oversized = `${"a".repeat(9_000)}TAIL`;

    const result = await makeAfterToolHandler(spec)({
      type: "tool_result",
      toolCallId: "call-ctx",
      toolName: "ctx_batch_execute",
      input: {},
      content: [{ type: "text", text: oversized }],
      isError: false,
      details: { serverName: "context-mode" },
    });

    expect(result?.content?.[0]?.text?.length).toBeLessThan(oversized.length);
    expect(result?.content?.[0]?.text).toContain("truncated");
    expect(result?.content?.[0]?.text).toContain("TAIL");
    expect(result?.details).toMatchObject({ truncated: true, originalTextChars: oversized.length });
  });

  it("leaves non-ctx tool results unchanged", async () => {
    const spec = new SpecEngine();

    const result = await makeAfterToolHandler(spec)({
      type: "tool_result",
      toolCallId: "call-bash",
      toolName: "bash",
      input: {},
      content: [{ type: "text", text: "a".repeat(9_000) }],
      isError: false,
      details: undefined,
    });

    expect(result).toBeUndefined();
  });

  it("records edit diffs as diff evidence", async () => {
    const spec = new SpecEngine();
    spec.generate("Add pagination", "ambient");

    await makeAfterToolHandler(spec)({
      type: "tool_result",
      toolCallId: "call-2",
      toolName: "edit",
      input: { path: "src/pagination.ts" },
      content: [{ type: "text", text: "Edited src/pagination.ts" }],
      isError: false,
      details: { diff: "--- a/src/pagination.ts\n+++ b/src/pagination.ts" },
    });

    const addResult = spec.verify().find((result) => result.criterion.statement === "Feature added as described");

    expect(addResult?.passed).toBe(true);
    expect(addResult?.evidence).toContain("edit changed src/pagination.ts");
  });
});

describe("truncateContextOutput — error/warning anchor preservation", () => {
  // Build a 12000-char string: 5000 head + 4000 middle (with error at position 6500) + 3000 tail
  // With new config (head=5000, tail=3000): middle = 4000 chars, error at position 6500 would fall
  // in the middle (positions 5000..8999) and be rescued by anchor scanning.
  // With old config (head=6800, tail=1200): error at 6500 is in HEAD and tail is too small to include
  // much — but this test cares about anchor scanning, so we verify the error line appears in output.

  it("preserves Error: lines from the dropped middle section via anchor scanning", async () => {
    const spec = new SpecEngine();
    // 12000-char string: error at position 7000.
    // With head=5000, tail=3000: middle is positions 5000..8999. Error at 7000 is in middle → rescued.
    // (Old head=6800 included position 7000 in head? No — 7000 >= 6800, so it was ALSO in old middle.)
    // Either way, we verify the error appears in the output after the fix.
    const errorLine = "Error: connection refused to database";
    // error must be on its own line so the ^ anchor in the regex can match it
    const part1 = "a".repeat(6999) + "\n";   // positions 0-6999 (with newline before error)
    const part3 = errorLine + "\n";          // position 7000
    const totalLen = 12_000;
    const part4 = "c".repeat(totalLen - 7000 - errorLine.length - 1 - 3000);  // filler
    const part5 = "d".repeat(3000);          // tail
    const oversized = part1 + part3 + part4 + part5;
    expect(oversized.length).toBe(totalLen);

    const result = await makeAfterToolHandler(spec)({
      type: "tool_result",
      toolCallId: "call-ctx",
      toolName: "ctx_run",
      input: {},
      content: [{ type: "text", text: oversized }],
      isError: false,
      details: {},
    });

    const output = result?.content?.[0]?.text ?? "";
    expect(output).toContain(errorLine);
    expect(output).toContain("truncated");
    expect(output.length).toBeLessThan(oversized.length);
  });

  it("uses a 3000-char tail so content 2500 chars from the end is preserved", async () => {
    const spec = new SpecEngine();
    // 12000-char string with a unique marker 2500 chars from the end.
    // Old tail=1200 would NOT capture it. New tail=3000 MUST capture it.
    const marker = "UNIQUE_TAIL_MARKER_2500_FROM_END";
    const total = 12_000;
    const markerPos = total - 2500;
    const oversized =
      "x".repeat(markerPos) + marker + "y".repeat(total - markerPos - marker.length);

    const result = await makeAfterToolHandler(spec)({
      type: "tool_result",
      toolCallId: "call-ctx2",
      toolName: "ctx_search",
      input: {},
      content: [{ type: "text", text: oversized }],
      isError: false,
      details: {},
    });

    const output = result?.content?.[0]?.text ?? "";
    expect(output).toContain(marker);
  });

  it("does not add high-signal anchors section when middle has no matching lines", async () => {
    const spec = new SpecEngine();
    const oversized = "a".repeat(12_000);

    const result = await makeAfterToolHandler(spec)({
      type: "tool_result",
      toolCallId: "call-ctx3",
      toolName: "ctx_execute",
      input: {},
      content: [{ type: "text", text: oversized }],
      isError: false,
      details: {},
    });

    const output = result?.content?.[0]?.text ?? "";
    expect(output).toContain("truncated");
    expect(output).not.toContain("High-signal lines");
  });
});

describe("after tool interaction audit", () => {
  it("records safe ask metadata after execution", async () => {
    const spec = { recordToolResult: vi.fn() };
    const auditLogger = { record: vi.fn(async () => undefined) };
    const handler = makeAfterToolHandler(spec as any, auditLogger as any, {
      sessionId: "s1",
      agentType: "parent",
    });

    await handler({
      toolName: "ask",
      content: [{ type: "text", text: JSON.stringify({ question: "Pick", selected: ["a"], recommended: "a", source: "user" }) }],
    });

    expect(auditLogger.record).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "ask",
      capability: "interaction",
      decision: "allow",
      metadata: expect.objectContaining({ selected: ["a"], recommended: "a", source: "user" }),
    }));
  });
});
