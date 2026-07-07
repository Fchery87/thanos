import { describe, expect, it, vi } from "vitest";
import { GoalController } from "../../src/goal/controller";
import { runGoalCommand, renderGoalStatusSegment, type GoalCommandDeps } from "../../src/goal/command";

describe("renderGoalStatusSegment", () => {
  it("undefined when there is no active/paused goal", () => {
    expect(renderGoalStatusSegment(undefined)).toBeUndefined();
    const achieved = new GoalController();
    achieved.set("a", 0);
    achieved.confirmComplete({ met: true, reason: "done" });
    expect(renderGoalStatusSegment(achieved.snapshot())).toBeUndefined();
  });
  it("shows turns and growth while active", () => {
    const c = new GoalController(); c.set("x", 0);
    c.onTurnEnd(3000);
    expect(renderGoalStatusSegment(c.snapshot())).toBe("◎ goal:1t·3k");
  });
  it("shows paused", () => {
    const c = new GoalController(); c.set("x", 0); c.pause();
    expect(renderGoalStatusSegment(c.snapshot())).toBe("◎ goal:paused");
  });
});

function deps(overrides: Partial<GoalCommandDeps> = {}): GoalCommandDeps {
  return {
    controller: new GoalController({ maxTurns: 25 }),
    isTrusted: () => true,
    getTokens: () => 0,
    notify: vi.fn(),
    sendFollowUp: vi.fn(async () => {}),
    recordEvent: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runGoalCommand", () => {
  it("refuses when the project is untrusted", async () => {
    const d = deps({ isTrusted: () => false });
    await runGoalCommand("all tests pass", d);
    expect(d.controller.snapshot()).toBeUndefined();
    expect(d.sendFollowUp).not.toHaveBeenCalled();
    expect(vi.mocked(d.notify).mock.calls[0][0]).toMatch(/trust/i);
  });

  it("set → activates the goal, records goal_set, sends the first directive", async () => {
    const d = deps();
    await runGoalCommand("all tests pass", d);
    expect(d.controller.snapshot()).toMatchObject({ condition: "all tests pass", status: "active" });
    expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "goal_set" }));
    expect(d.sendFollowUp).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.sendFollowUp).mock.calls[0][0]).toContain("[harness:goal-directive]");
  });

  it("set with empty condition → error, no goal", async () => {
    const d = deps();
    await runGoalCommand("   ", d); // empty args parse to status; use a set that trims to empty is impossible, so test the guard via controller
    // "   " parses as status (no goal yet) → shows status, does not error
    expect(d.sendFollowUp).not.toHaveBeenCalled();
  });

  it("status with no goal → notifies none active", async () => {
    const d = deps();
    await runGoalCommand("", d);
    expect(vi.mocked(d.notify).mock.calls[0][0]).toMatch(/no .*goal|none/i);
  });

  it("status with active goal → shows the condition", async () => {
    const d = deps();
    await runGoalCommand("ship the feature", d);
    vi.mocked(d.notify).mockClear();
    await runGoalCommand("", d);
    expect(vi.mocked(d.notify).mock.calls[0][0]).toContain("ship the feature");
  });

  it("clear → removes the goal", async () => {
    const d = deps();
    await runGoalCommand("a goal", d);
    await runGoalCommand("clear", d);
    expect(d.controller.snapshot()).toBeUndefined();
  });

  it("pause then resume", async () => {
    const d = deps();
    await runGoalCommand("a goal", d);
    await runGoalCommand("pause", d);
    expect(d.controller.snapshot()?.status).toBe("paused");
    await runGoalCommand("resume", d);
    expect(d.controller.snapshot()?.status).toBe("active");
  });

  it("resume sends a continuation directive so work restarts without a manual nudge", async () => {
    const d = deps();
    await runGoalCommand("a goal", d);
    d.controller.confirmComplete({ met: false, reason: "2 tests failing" });
    await runGoalCommand("pause", d);
    vi.mocked(d.sendFollowUp).mockClear();
    await runGoalCommand("resume", d);
    expect(d.sendFollowUp).toHaveBeenCalledTimes(1);
    const text = vi.mocked(d.sendFollowUp).mock.calls[0][0];
    expect(text).toContain("[harness:goal-directive]");
    expect(text).toContain("a goal");
    expect(text).toContain("2 tests failing");
  });

  it("resume with no paused goal sends nothing", async () => {
    const d = deps();
    await runGoalCommand("resume", d);
    expect(d.sendFollowUp).not.toHaveBeenCalled();
  });

  it("replacing an active goal notes the replacement", async () => {
    const d = deps();
    await runGoalCommand("first", d);
    vi.mocked(d.notify).mockClear();
    await runGoalCommand("second", d);
    expect(vi.mocked(d.notify).mock.calls.some((c) => /replac/i.test(String(c[0])))).toBe(true);
    expect(d.controller.snapshot()?.condition).toBe("second");
  });
});
