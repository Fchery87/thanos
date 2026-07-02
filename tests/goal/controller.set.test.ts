import { describe, expect, it } from "vitest";
import { GoalController } from "../../src/goal/controller";

const now = () => 1000;

describe("GoalController set/clear", () => {
  it("rejects empty condition", () => {
    const c = new GoalController({}, now);
    expect(c.set("   ", 0).ok).toBe(false);
  });
  it("rejects >4000 chars", () => {
    const c = new GoalController({}, now);
    expect(c.set("x".repeat(4001), 0).ok).toBe(false);
  });
  it("sets an active goal; first directive carries the sentinel + condition", () => {
    const c = new GoalController({}, now);
    const r = c.set("all tests pass", 500);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.replaced).toBe(false);
      expect(r.firstDirective).toContain("all tests pass");
      expect(r.firstDirective).toContain("[harness:goal-directive]");
    }
    expect(c.snapshot()).toMatchObject({
      condition: "all tests pass", status: "active", turnsEvaluated: 0, tokensUsed: 0,
    });
  });
  it("replacing an active goal reports replaced:true", () => {
    const c = new GoalController({}, now);
    c.set("a", 0);
    const r = c.set("b", 0);
    expect(r.ok && r.replaced).toBe(true);
    expect(c.snapshot()?.condition).toBe("b");
  });
  it("clear removes the goal", () => {
    const c = new GoalController({}, now);
    c.set("a", 0); c.clear();
    expect(c.snapshot()).toBeUndefined();
  });
});

describe("GoalController pause/resume", () => {
  it("pause moves active→paused; resume moves back", () => {
    const c = new GoalController({}, now);
    c.set("a", 0);
    expect(c.pause()).toBe(true);
    expect(c.snapshot()?.status).toBe("paused");
    expect(c.resume()).toBe(true);
    expect(c.snapshot()?.status).toBe("active");
  });
  it("pause when not active / resume when not paused return false", () => {
    const c = new GoalController({}, now);
    expect(c.pause()).toBe(false);
    c.set("a", 0);
    expect(c.resume()).toBe(false);
  });
});
