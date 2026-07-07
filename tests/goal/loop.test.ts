import { describe, expect, it, vi } from "vitest";
import { GoalController } from "../../src/goal/controller";
import { handleAgentEnd, type LoopDeps } from "../../src/goal/loop";

function deps(overrides: Partial<LoopDeps> = {}): LoopDeps {
  return {
    controller: new GoalController({ maxTurns: 25 }),
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
    await handleAgentEnd(d, { willRetry: true });
    await handleAgentEnd(d, { willRetry: false });
    expect(d.sendDirective).not.toHaveBeenCalled();
    expect(d.controller.snapshot()?.turnsEvaluated).toBe(0);
  });

  it("skips when willRetry is true", async () => {
    const d = deps(); d.controller.set("a", 0);
    await handleAgentEnd(d, { willRetry: true });
    expect(d.sendDirective).not.toHaveBeenCalled();
    expect(d.controller.snapshot()?.turnsEvaluated).toBe(0);
  });

  it("active goal → advances the turn and sends the continuation directive", async () => {
    const d = deps(); d.controller.set("cond", 0);
    await handleAgentEnd(d, { willRetry: false });
    expect(d.sendDirective).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.sendDirective).mock.calls[0][0]).toContain("goal_complete");
    expect(d.controller.snapshot()?.turnsEvaluated).toBe(1);
  });

  it("does nothing once the goal is achieved (completion happens in the tool)", async () => {
    const d = deps(); d.controller.set("cond", 0);
    d.controller.confirmComplete({ met: true, reason: "done" });
    await handleAgentEnd(d, { willRetry: false });
    expect(d.sendDirective).not.toHaveBeenCalled();
  });

  it("hitting the ceiling → notifies + records goal_paused, no directive", async () => {
    const d = deps({ controller: new GoalController({ maxTurns: 1 }) });
    d.controller.set("cond", 0);
    await handleAgentEnd(d, { willRetry: false });
    expect(d.sendDirective).not.toHaveBeenCalled();
    expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "goal_paused" }));
    expect(d.controller.snapshot()?.status).toBe("paused");
  });
});
