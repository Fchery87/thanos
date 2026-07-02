import { describe, expect, it, vi } from "vitest";
import { runEvaluatorWith } from "../../src/goal/evaluator";

describe("runEvaluatorWith", () => {
  it("builds the context, calls complete, and parses the verdict", async () => {
    const complete = vi.fn(async () => ({
      content: [{ type: "text", text: "VERDICT: NOT_MET\nREASON: no test output shown" }],
    }));
    const v = await runEvaluatorWith(complete as never, {
      condition: "tests pass", lastAssistantText: "did stuff", toolResultsText: "",
    });
    expect(v).toEqual({ met: false, reason: "no test output shown" });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("empty completion text is fail-safe NOT_MET", async () => {
    const complete = vi.fn(async () => ({ content: [] }));
    const v = await runEvaluatorWith(complete as never, {
      condition: "x", lastAssistantText: "", toolResultsText: "",
    });
    expect(v.met).toBe(false);
  });
});
