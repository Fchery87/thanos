import { describe, expect, it } from "vitest";
import { GoalController } from "../../src/goal/controller";
import { serializeGoal, restoreController } from "../../src/goal/persist";

describe("goal persistence", () => {
  it("serializes an active goal with its status", () => {
    const c = new GoalController(); c.set("cond", 500);
    expect(serializeGoal(c)).toEqual({ condition: "cond", status: "active" });
  });
  it("serializes a paused goal as paused", () => {
    const c = new GoalController(); c.set("cond", 0); c.pause();
    expect(serializeGoal(c)).toEqual({ condition: "cond", status: "paused" });
  });
  it("does not serialize achieved/cleared goals", () => {
    const c = new GoalController(); c.set("cond", 0);
    c.onTurnResult({ met: true, reason: "x" }, 0);
    expect(serializeGoal(c)).toBeUndefined();
    const c2 = new GoalController();
    expect(serializeGoal(c2)).toBeUndefined();
  });
  it("restore rebuilds an active goal with reset baselines", () => {
    const c = restoreController({ condition: "cond", status: "active" }, { maxTurns: 25 }, () => 42, 900);
    expect(c.snapshot()).toMatchObject({
      condition: "cond", status: "active", turnsEvaluated: 0, startedAt: 42, tokensUsed: 0,
    });
  });
  it("restore keeps a paused goal paused (it must not silently auto-loop)", () => {
    const c = restoreController({ condition: "cond", status: "paused" }, undefined, () => 42, 0);
    expect(c.snapshot()?.status).toBe("paused");
  });
});
