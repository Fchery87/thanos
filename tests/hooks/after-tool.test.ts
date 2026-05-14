import { describe, expect, it } from "vitest";

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
