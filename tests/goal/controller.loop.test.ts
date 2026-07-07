import { describe, expect, it } from "vitest";
import { GoalController } from "../../src/goal/controller";

const met = { met: true, reason: "done" };
const notMet = { met: false, reason: "still failing" };

describe("onTurnEnd", () => {
  it("no active goal → noop", () => {
    expect(new GoalController().onTurnEnd(0)).toEqual({ kind: "noop" });
  });

  it("budget left → continue with directive containing the sentinel", () => {
    const c = new GoalController({ maxTurns: 25 }); c.set("cond", 0);
    const action = c.onTurnEnd(5);
    expect(action.kind).toBe("continue");
    if (action.kind === "continue") {
      // The condition now rides in the system prompt, not the per-turn directive.
      expect(action.directive).toContain("[harness:goal-directive]");
      expect(action.directive).toContain("goal_complete");
    }
    expect(c.snapshot()?.turnsEvaluated).toBe(1);
  });

  it("hitting maxTurns → paused (ceiling-turns), not cleared", () => {
    const c = new GoalController({ maxTurns: 2 }); c.set("cond", 0);
    expect(c.onTurnEnd(0).kind).toBe("continue");
    expect(c.onTurnEnd(0)).toMatchObject({ kind: "paused", why: "ceiling-turns" });
    expect(c.snapshot()?.status).toBe("paused");
  });

  it("accumulates clamped token growth; ceiling fires on cumulative use", () => {
    const c = new GoalController({ maxTurns: 0, maxTokens: 150 }); c.set("cond", 1000);
    expect(c.onTurnEnd(1100).kind).toBe("continue"); // +100 → 100
    const action = c.onTurnEnd(1160);                 // +60 → 160 ≥ 150
    expect(action).toMatchObject({ kind: "paused", why: "ceiling-tokens" });
    expect(c.snapshot()?.tokensUsed).toBe(160);
  });

  it("compaction (context shrink) never decrements the counter", () => {
    const c = new GoalController({ maxTurns: 0, maxTokens: 500 }); c.set("cond", 1000);
    c.onTurnEnd(1200);            // +200 → 200
    const a = c.onTurnEnd(300);   // shrank: clamp to +0 → still 200
    expect(a.kind).toBe("continue");
    expect(c.snapshot()?.tokensUsed).toBe(200);
    c.onTurnEnd(400);            // +100 → 300 (baseline rebased to 300)
    expect(c.snapshot()?.tokensUsed).toBe(300);
  });

  it("checkpointEvery N → paused (checkpoint) on the Nth turn", () => {
    const c = new GoalController({ maxTurns: 0, checkpointEvery: 2 }); c.set("cond", 0);
    expect(c.onTurnEnd(0).kind).toBe("continue");
    expect(c.onTurnEnd(0)).toMatchObject({ kind: "paused", why: "checkpoint" });
  });

  it("resume after a turn-ceiling pause grants a fresh window, not one turn", () => {
    const c = new GoalController({ maxTurns: 2 }); c.set("cond", 0);
    c.onTurnEnd(0);
    expect(c.onTurnEnd(0)).toMatchObject({ kind: "paused", why: "ceiling-turns" });
    expect(c.resume()).toBe(true);
    expect(c.onTurnEnd(0).kind).toBe("continue");
    expect(c.onTurnEnd(0)).toMatchObject({ kind: "paused", why: "ceiling-turns" });
  });

  it("resume after a token-ceiling pause grants a fresh growth window", () => {
    const c = new GoalController({ maxTurns: 0, maxTokens: 100 }); c.set("cond", 0);
    expect(c.onTurnEnd(120)).toMatchObject({ kind: "paused", why: "ceiling-tokens" });
    expect(c.resume()).toBe(true);
    expect(c.onTurnEnd(150).kind).toBe("continue"); // +30 since resume < 100
    expect(c.onTurnEnd(260)).toMatchObject({ kind: "paused", why: "ceiling-tokens" }); // +140 since resume
  });

  it("paused goal ignores turn ends → noop", () => {
    const c = new GoalController(); c.set("a", 0); c.pause();
    expect(c.onTurnEnd(0)).toEqual({ kind: "noop" });
  });
});

describe("confirmComplete", () => {
  it("no active goal → noop", () => {
    expect(new GoalController().confirmComplete(met)).toEqual({ kind: "noop" });
  });

  it("MET → achieved with turn count, and status becomes achieved", () => {
    const c = new GoalController(); c.set("a", 0);
    c.onTurnEnd(10); // one work turn
    expect(c.confirmComplete(met)).toEqual({ kind: "achieved", reason: "done", turns: 1 });
    expect(c.snapshot()?.status).toBe("achieved");
  });

  it("NOT_MET → rejected, goal stays active and records the reason", () => {
    const c = new GoalController(); c.set("cond", 0);
    expect(c.confirmComplete(notMet)).toEqual({ kind: "rejected", reason: "still failing" });
    expect(c.snapshot()?.status).toBe("active");
    expect(c.snapshot()?.lastReason).toBe("still failing");
  });

  it("a rejected completion never advances the turn ceiling", () => {
    const c = new GoalController({ maxTurns: 1 }); c.set("cond", 0);
    // Confirming (and being rejected) must not consume the single-turn window.
    expect(c.confirmComplete(notMet).kind).toBe("rejected");
    expect(c.snapshot()?.turnsEvaluated).toBe(0);
    expect(c.snapshot()?.status).toBe("active");
  });

  it("paused goal ignores completion → noop", () => {
    const c = new GoalController(); c.set("a", 0); c.pause();
    expect(c.confirmComplete(met)).toEqual({ kind: "noop" });
  });
});

describe("onError", () => {
  it("pauses an active goal with the error kind", () => {
    const c = new GoalController(); c.set("a", 0);
    expect(c.onError("eval-error", "boom")).toMatchObject({ kind: "paused", why: "eval-error" });
    expect(c.snapshot()?.status).toBe("paused");
  });
});
