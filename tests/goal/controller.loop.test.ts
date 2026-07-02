import { describe, expect, it } from "vitest";
import { GoalController } from "../../src/goal/controller";

const met = { met: true, reason: "done" };
const notMet = { met: false, reason: "still failing" };

describe("onTurnResult", () => {
  it("no active goal → noop", () => {
    expect(new GoalController().onTurnResult(notMet, 0)).toEqual({ kind: "noop" });
  });

  it("MET → achieved with turn count, and status becomes achieved", () => {
    const c = new GoalController(); c.set("a", 0);
    expect(c.onTurnResult(met, 10)).toEqual({ kind: "achieved", reason: "done", turns: 1 });
    expect(c.snapshot()?.status).toBe("achieved");
  });

  it("NOT_MET with budget left → continue with directive containing sentinel + reason", () => {
    const c = new GoalController({ maxTurns: 25 }); c.set("cond", 0);
    const action = c.onTurnResult(notMet, 5);
    expect(action.kind).toBe("continue");
    if (action.kind === "continue") {
      expect(action.directive).toContain("still failing");
      expect(action.directive).toContain("[harness:goal-directive]");
    }
    expect(c.snapshot()?.turnsEvaluated).toBe(1);
    expect(c.snapshot()?.lastReason).toBe("still failing");
  });

  it("hitting maxTurns → paused (ceiling-turns), not cleared", () => {
    const c = new GoalController({ maxTurns: 2 }); c.set("cond", 0);
    expect(c.onTurnResult(notMet, 0).kind).toBe("continue");
    expect(c.onTurnResult(notMet, 0)).toMatchObject({ kind: "paused", why: "ceiling-turns" });
    expect(c.snapshot()?.status).toBe("paused");
  });

  it("accumulates clamped token growth; ceiling fires on cumulative use", () => {
    const c = new GoalController({ maxTurns: 0, maxTokens: 150 }); c.set("cond", 1000);
    expect(c.onTurnResult(notMet, 1100).kind).toBe("continue"); // +100 → 100
    const action = c.onTurnResult(notMet, 1160);                 // +60 → 160 ≥ 150
    expect(action).toMatchObject({ kind: "paused", why: "ceiling-tokens" });
    expect(c.snapshot()?.tokensUsed).toBe(160);
  });

  it("compaction (context shrink) never decrements the counter", () => {
    const c = new GoalController({ maxTurns: 0, maxTokens: 500 }); c.set("cond", 1000);
    c.onTurnResult(notMet, 1200);            // +200 → 200
    const a = c.onTurnResult(notMet, 300);   // shrank: clamp to +0 → still 200
    expect(a.kind).toBe("continue");
    expect(c.snapshot()?.tokensUsed).toBe(200);
    c.onTurnResult(notMet, 400);             // +100 → 300 (baseline rebased to 300)
    expect(c.snapshot()?.tokensUsed).toBe(300);
  });

  it("checkpointEvery N → paused (checkpoint) on the Nth turn", () => {
    const c = new GoalController({ maxTurns: 0, checkpointEvery: 2 }); c.set("cond", 0);
    expect(c.onTurnResult(notMet, 0).kind).toBe("continue");
    expect(c.onTurnResult(notMet, 0)).toMatchObject({ kind: "paused", why: "checkpoint" });
  });

  it("paused goal ignores turn results → noop", () => {
    const c = new GoalController(); c.set("a", 0); c.pause();
    expect(c.onTurnResult(notMet, 0)).toEqual({ kind: "noop" });
  });

  it("onError pauses an active goal with the error kind", () => {
    const c = new GoalController(); c.set("a", 0);
    expect(c.onError("eval-error", "boom")).toMatchObject({ kind: "paused", why: "eval-error" });
    expect(c.snapshot()?.status).toBe("paused");
  });
});
