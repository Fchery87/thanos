import { describe, expect, it, vi } from "vitest";
import { runEvaluator } from "../../src/evaluation/runtime";

describe("runEvaluator", () => {
  it("returns PASS when evaluator outputs PASS on first line", async () => {
    const complete = vi.fn(async () => ({
      text: "PASS - all criteria met\n\nevidence: ...",
      model: "test-model",
      provider: "test",
      tokenUsage: { input: 100, output: 50 },
    }));

    const result = await runEvaluator(complete);

    expect(result.verdict).toContain("PASS");
    expect(result.attempts).toBe(1);
    expect(result.fallbackUsed).toBe(false);
    expect(result.model).toBe("test-model");
    expect(result.provider).toBe("test");
    expect(result.tokenUsage).toEqual({ input: 100, output: 50 });
  });

  it("returns NEEDS_WORK when evaluator outputs NEEDS_WORK", async () => {
    const complete = vi.fn(async () => ({
      text: "NEEDS_WORK - missing test evidence",
    }));

    const result = await runEvaluator(complete);

    expect(result.verdict).toContain("NEEDS_WORK");
    expect(result.attempts).toBe(1);
    expect(result.fallbackUsed).toBe(false);
  });

  it("returns fallback verdict when evaluator output is empty", async () => {
    const complete = vi.fn(async () => ({ text: "" }));

    const result = await runEvaluator(complete);

    expect(result.verdict).toContain("NEEDS_WORK");
    expect(result.fallbackUsed).toBe(false);
  });

  it("retries once on first attempt failure", async () => {
    let calls = 0;
    const complete = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("transient error");
      return { text: "PASS" };
    });

    const result = await runEvaluator(complete);

    expect(result.verdict).toContain("PASS");
    expect(result.attempts).toBe(2);
    expect(calls).toBe(2);
  });

  it("returns fallback after max attempts exhausted", async () => {
    const complete = vi.fn(async () => {
      throw new Error("always fails");
    });

    const result = await runEvaluator(complete, { maxAttempts: 2 });

    expect(result.verdict).toContain("NEEDS_WORK");
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain("always fails");
    expect(result.attempts).toBe(2);
  });

  it("returns fallback on abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const complete = vi.fn(async () => ({ text: "PASS" }));

    const result = await runEvaluator(complete, { signal: controller.signal });

    expect(result.verdict).toContain("NEEDS_WORK");
    expect(result.fallbackUsed).toBe(true);
  });

  it("finds PASS/NEDS_WORK anywhere in output when not on first line", async () => {
    const complete = vi.fn(async () => ({
      text: "summary: evaluator checked all evidence\nConclusion: PASS - verified",
    }));

    const result = await runEvaluator(complete);

    expect(result.verdict).toContain("PASS");
  });

  it("returns fallback when no PASS/NEDS_WORK found", async () => {
    const complete = vi.fn(async () => ({
      text: "I have reviewed the evidence and everything looks good to me.",
    }));

    const result = await runEvaluator(complete);

    expect(result.verdict).toContain("NEEDS_WORK");
  });

  it("bounds output size", async () => {
    const longText = "PASS - " + "x".repeat(40_000);
    const complete = vi.fn(async () => ({ text: longText }));

    const result = await runEvaluator(complete, { maxOutputBytes: 2048 });

    expect(result.rawOutput.length).toBeLessThanOrEqual(2048);
    expect(result.verdict).toContain("PASS");
  });
});
