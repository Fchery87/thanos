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
