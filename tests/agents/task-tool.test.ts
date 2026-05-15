import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { formatTaskRunResult, TaskBatchParamsSchema, validateTaskBatch } from "../../src/agents/task-tool";

describe("task structured result contract", () => {
  it("formats a successful task result as JSON-compatible data", () => {
    const result = formatTaskRunResult({
      id: "AuditPolicy",
      type: "explore",
      goal: "Inspect policy code",
      text: "done",
      ok: true,
    });

    expect(result).toEqual({
      id: "AuditPolicy",
      type: "explore",
      goal: "Inspect policy code",
      text: "done",
      ok: true,
    });
  });
});

describe("task batch schema", () => {
  it("accepts typed task batches", () => {
    expect(Value.Check(TaskBatchParamsSchema, {
      tasks: [
        { id: "AuditPolicy", type: "explore", goal: "Inspect policy code" },
        { id: "AuditSpecs", type: "explore", goal: "Inspect spec code" },
      ],
    })).toBe(true);
  });

  it("rejects duplicate batch ids with helper validation", () => {
    expect(() => validateTaskBatch([
      { id: "Same", type: "explore", goal: "A" },
      { id: "Same", type: "explore", goal: "B" },
    ])).toThrow(/duplicate/i);
  });
});
