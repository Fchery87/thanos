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

  // completeSimple resolves (never rejects) on API errors: the message carries
  // stopReason "error" + errorMessage and empty content. That must THROW so the
  // caller's fallback runs and the real error surfaces — not parse as
  // "evaluator output unreadable" with an empty head.
  it("throws the underlying errorMessage when the completion resolves with stopReason error", async () => {
    const complete = vi.fn(async () => ({
      stopReason: "error",
      errorMessage: "No API key for provider: someprovider",
      content: [],
    }));
    await expect(
      runEvaluatorWith(complete as never, { condition: "x", lastAssistantText: "", toolResultsText: "" }),
    ).rejects.toThrow(/No API key for provider: someprovider/);
  });

  it("throws on stopReason aborted even if error message is absent", async () => {
    const complete = vi.fn(async () => ({ stopReason: "aborted", content: [] }));
    await expect(
      runEvaluatorWith(complete as never, { condition: "x", lastAssistantText: "", toolResultsText: "" }),
    ).rejects.toThrow(/aborted/);
  });
});
