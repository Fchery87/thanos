import { describe, expect, it } from "vitest";
import { GoalController } from "../../src/goal/controller";
import { serializeGoal, restoreController } from "../../src/goal/persist";

describe("goal persistence", () => {
  it("serializes only active goal intent, never runtime authority", () => {
    const c = new GoalController(); c.set("cond", 500);
    expect(serializeGoal(c)).toEqual({ condition: "cond" });
  });
  it("serializes paused goal intent identically", () => {
    const c = new GoalController(); c.set("cond", 0); c.pause();
    expect(serializeGoal(c)).toEqual({ condition: "cond" });
  });
  it("does not serialize achieved/cleared goals", () => {
    const c = new GoalController(); c.set("cond", 0);
    c.confirmComplete({ met: true, reason: "x" });
    expect(serializeGoal(c)).toBeUndefined();
    const c2 = new GoalController();
    expect(serializeGoal(c2)).toBeUndefined();
  });
  it("restore turns persisted active intent into a paused goal without restoring authority", () => {
    const c = restoreController({ condition: "cond" }, { maxTurns: 25 }, () => 42, 900);
    expect(c.snapshot()).toMatchObject({
      condition: "cond", status: "paused", turnsEvaluated: 0, startedAt: 42, tokensUsed: 0,
    });
    expect(c.onTurnEnd(950)).toEqual({ kind: "noop" });
  });
  it("restore keeps a paused goal paused (it must not silently auto-loop)", () => {
    const c = restoreController({ condition: "cond" }, undefined, () => 42, 0);
    expect(c.snapshot()?.status).toBe("paused");
  });
});
