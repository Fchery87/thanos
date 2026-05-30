import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { formatTaskRunResult, TaskBatchParamsSchema, validateTaskBatch } from "../../src/agents/task-tool";
import { contractToTranscriptStatus, contractReturnPayload } from "../../src/agents/task-tool";
import { renderContractForDisplay, applyHarnessStatus } from "../../src/agents/task-tool";
import type { SubagentResultContract } from "../../src/agents/result";

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

describe("task-tool contract helpers", () => {
  const base: SubagentResultContract = {
    status: "success", summary: "ok", findings: [], artifacts: [], escalations: [],
  };

  it("maps contract status to a transcript status", () => {
    expect(contractToTranscriptStatus({ ...base, status: "success" })).toBe("success");
    expect(contractToTranscriptStatus({ ...base, status: "error" })).toBe("error");
    expect(contractToTranscriptStatus({ ...base, status: "timeout" })).toBe("timeout");
    expect(contractToTranscriptStatus({ ...base, status: "escalated" })).toBe("escalated");
  });

  it("returns the full contract as a JSON string payload", () => {
    const payload = contractReturnPayload(base);
    expect(JSON.parse(payload)).toEqual(base);
  });
});

describe("renderContractForDisplay", () => {
  it("shows the summary as prose", () => {
    expect(renderContractForDisplay(JSON.stringify({
      status: "success", summary: "all good", findings: [], artifacts: [], escalations: [],
    }))).toBe("all good");
  });

  it("appends a findings count when present", () => {
    const out = renderContractForDisplay(JSON.stringify({
      status: "success", summary: "review done",
      findings: [{ priority: "P1", summary: "x" }, { priority: "P2", summary: "y" }],
      artifacts: [], escalations: [],
    }));
    expect(out).toContain("review done");
    expect(out).toContain("Findings: 2");
  });

  it("surfaces escalation questions", () => {
    const out = renderContractForDisplay(JSON.stringify({
      status: "escalated", summary: "blocked", findings: [], artifacts: [],
      escalations: [{ question: "which db?" }],
    }));
    expect(out).toContain("Needs input: which db?");
  });

  it("renders plain (non-JSON) text as its own summary", () => {
    expect(renderContractForDisplay("just prose")).toBe("just prose");
  });
});

describe("applyHarnessStatus", () => {
  const mk = () => ({ status: "success" as const, summary: "", findings: [], artifacts: [], escalations: [] });

  it("forces timeout when timedOut, even with exit code", () => {
    expect(applyHarnessStatus(mk(), { timedOut: true, code: 1 }).status).toBe("timeout");
  });

  it("maps a nonzero exit code to error", () => {
    expect(applyHarnessStatus(mk(), { timedOut: false, code: 2 }).status).toBe("error");
  });

  it("leaves the contract status untouched on clean exit (code 0)", () => {
    expect(applyHarnessStatus(mk(), { timedOut: false, code: 0 }).status).toBe("success");
  });

  it("treats a null exit code (signal kill) as non-error pass-through", () => {
    const c = mk(); c.status = "escalated" as never;
    expect(applyHarnessStatus(c, { timedOut: false, code: null }).status).toBe("escalated");
  });
});
