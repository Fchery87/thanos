import { describe, expect, it, vi } from "vitest";
import { GoalController } from "../../src/goal/controller";
import { handleAgentEnd, type LoopDeps } from "../../src/goal/loop";

function deps(overrides: Partial<LoopDeps> = {}): LoopDeps {
  return {
    controller: new GoalController({ maxTurns: 25 }),
    runEvaluator: vi.fn(async () => ({ met: false, reason: "still failing" })),
    sendDirective: vi.fn(async () => {}),
    notify: vi.fn(),
    recordEvent: vi.fn(async () => {}),
    getTokens: () => 100,
    isSubagent: false,
    ...overrides,
  };
}

describe("handleAgentEnd", () => {
  it("does nothing inside a subagent", async () => {
    const d = deps({ isSubagent: true }); d.controller.set("a", 0);
    await handleAgentEnd(d, { willRetry: false, lastAssistantText: "", toolResultsText: "" });
    expect(d.runEvaluator).not.toHaveBeenCalled();
  });

  it("skips when willRetry is true", async () => {
    const d = deps(); d.controller.set("a", 0);
    await handleAgentEnd(d, { willRetry: true, lastAssistantText: "", toolResultsText: "" });
    expect(d.runEvaluator).not.toHaveBeenCalled();
  });

  it("NOT_MET → sends the continuation directive", async () => {
    const d = deps(); d.controller.set("cond", 0);
    await handleAgentEnd(d, { willRetry: false, lastAssistantText: "x", toolResultsText: "y" });
    expect(d.sendDirective).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.sendDirective).mock.calls[0][0]).toContain("still failing");
  });

  it("MET → notifies achievement + records goal_achieved, no further directive", async () => {
    const d = deps({ runEvaluator: vi.fn(async () => ({ met: true, reason: "done" })) });
    d.controller.set("cond", 0);
    await handleAgentEnd(d, { willRetry: false, lastAssistantText: "", toolResultsText: "" });
    expect(d.sendDirective).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalled();
    expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "goal_achieved" }));
  });

  it("pause (ceiling) → notifies + records goal_paused", async () => {
    const d = deps({ controller: new GoalController({ maxTurns: 1 }) });
    d.controller.set("cond", 0);
    await handleAgentEnd(d, { willRetry: false, lastAssistantText: "", toolResultsText: "" });
    expect(d.sendDirective).not.toHaveBeenCalled();
    expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "goal_paused" }));
  });

  it("evaluator throwing twice → pauses (eval-error), no directive", async () => {
    const runEvaluator = vi.fn(async () => { throw new Error("boom"); });
    const d = deps({ runEvaluator }); d.controller.set("cond", 0);
    await handleAgentEnd(d, { willRetry: false, lastAssistantText: "", toolResultsText: "" });
    expect(runEvaluator).toHaveBeenCalledTimes(2); // one retry
    expect(d.sendDirective).not.toHaveBeenCalled();
    expect(d.controller.snapshot()?.status).toBe("paused");
  });
});
