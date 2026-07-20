import { describe, expect, it, vi } from "vitest";
import { confirmGoalCompletion, type ConfirmInput } from "../../src/goal/confirm";
import type { EvaluatorInput } from "../../src/goal/prompts";
import type { Verdict } from "../../src/goal/types";

type Runner = (i: EvaluatorInput) => Promise<Verdict>;
const runner = (impl: Runner) => vi.fn<Runner>(impl);

const met: Verdict = { met: true, reason: "all green" };

function input(overrides: Partial<ConfirmInput> = {}): ConfirmInput {
  return {
    condition: "all tests pass",
    summary: "ran the suite",
    evidence: { lastAssistantText: "0 failures", toolResultsText: "exit 0" },
    ...overrides,
  };
}

describe("confirmGoalCompletion", () => {
  it("passes surfaced evidence (with the claim prepended) to the primary evaluator", async () => {
    const primary = runner(async () => met);
    const fallback = runner(async () => met);
    const v = await confirmGoalCompletion(input(), primary, fallback);
    expect(v).toEqual(met);
    expect(fallback).not.toHaveBeenCalled();
    const seen = primary.mock.calls[0][0];
    expect(seen.assistantClaim).toContain("AGENT COMPLETION CLAIM:");
    expect(seen.assistantClaim).toContain("ran the suite");
    expect(seen.assistantClaim).toContain("0 failures");
    expect(seen.toolResultsText).toBe("exit 0");
  });

  it("FAILS CLOSED when the turn has no evidence — never judges the bare summary claim", async () => {
    const primary = runner(async () => met);
    const fallback = runner(async () => met);
    const v = await confirmGoalCompletion(
      input({ summary: "trust me, it's done", evidence: { lastAssistantText: "", toolResultsText: "" } }),
      primary, fallback,
    );
    expect(v.met).toBe(false);
    expect(v.reason).toMatch(/no verifiable evidence/i);
    // The model must not be consulted at all — that is what prevents self-grading.
    expect(primary).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("treats whitespace-only evidence as no evidence (fail closed)", async () => {
    const primary = runner(async () => met);
    const v = await confirmGoalCompletion(
      input({ evidence: { lastAssistantText: "   \n ", toolResultsText: "  " } }),
      primary, runner(async () => met),
    );
    expect(v.met).toBe(false);
    expect(primary).not.toHaveBeenCalled();
  });

  it("retries once on the fallback when the primary evaluator throws", async () => {
    const primary = runner(async () => { throw new Error("provider 503"); });
    const fallback = runner(async () => met);
    const v = await confirmGoalCompletion(input(), primary, fallback);
    expect(v).toEqual(met);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("fails SAFE to NOT_MET when both primary and fallback throw — never closes, never pauses", async () => {
    const primary = runner(async () => { throw new Error("boom"); });
    const fallback = runner(async () => { throw new Error("boom2"); });
    const v = await confirmGoalCompletion(input(), primary, fallback);
    expect(v.met).toBe(false);
    expect(v.reason).toMatch(/errored/i);
    expect(v.reason).toContain("boom2");
  });

  it("judges on evidence even when the agent gives no summary", async () => {
    const primary = runner(async () => met);
    const v = await confirmGoalCompletion(
      input({ summary: "  ", evidence: { lastAssistantText: "0 failures", toolResultsText: "" } }),
      primary, runner(async () => met),
    );
    expect(v).toEqual(met);
    expect(primary.mock.calls[0][0].assistantClaim).toBe("0 failures");
    expect(primary.mock.calls[0][0].assistantClaim).not.toContain("CLAIM");
  });
});
