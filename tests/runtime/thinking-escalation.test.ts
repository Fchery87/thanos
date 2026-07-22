import { describe, expect, it } from "vitest";
import { computeThinkingEscalation, NO_ESCALATION } from "../../src/runtime/thinking-escalation";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

describe("computeThinkingEscalation", () => {
  it("escalates to the model's top level when high-assurance work starts", () => {
    const r = computeThinkingEscalation({ active: true, supportedLevels: LEVELS, current: "medium", state: NO_ESCALATION });
    expect(r.setLevel).toBe("xhigh");
    expect(r.state).toEqual({ saved: "medium", escalatedTo: "xhigh" });
  });

  it("holds at max on subsequent active turns (no redundant set)", () => {
    const state = { saved: "medium", escalatedTo: "xhigh" };
    const r = computeThinkingEscalation({ active: true, supportedLevels: LEVELS, current: "xhigh", state });
    expect(r.setLevel).toBeUndefined();
    expect(r.state).toEqual(state);
  });

  it("records state without a set when the user was already at the ceiling", () => {
    const r = computeThinkingEscalation({ active: true, supportedLevels: LEVELS, current: "xhigh", state: NO_ESCALATION });
    expect(r.setLevel).toBeUndefined();
    expect(r.state).toEqual({ saved: "xhigh", escalatedTo: "xhigh" });
  });

  it("restores the saved baseline when high-assurance work ends", () => {
    const state = { saved: "medium", escalatedTo: "xhigh" };
    const r = computeThinkingEscalation({ active: false, supportedLevels: LEVELS, current: "xhigh", state });
    expect(r.setLevel).toBe("medium");
    expect(r.state).toEqual(NO_ESCALATION);
  });

  it("respects a manual override mid-goal instead of clobbering it on restore", () => {
    const state = { saved: "medium", escalatedTo: "xhigh" };
    // User dropped to "low" via /thinking while the goal was running.
    const r = computeThinkingEscalation({ active: false, supportedLevels: LEVELS, current: "low", state });
    expect(r.setLevel).toBeUndefined();
    expect(r.state).toEqual(NO_ESCALATION);
  });

  it("is a no-op when nothing is active and nothing was escalated", () => {
    const r = computeThinkingEscalation({ active: false, supportedLevels: LEVELS, current: "medium", state: NO_ESCALATION });
    expect(r.setLevel).toBeUndefined();
    expect(r.state).toEqual(NO_ESCALATION);
  });

  it("does not escalate on a non-reasoning model and drops any prior state", () => {
    const r = computeThinkingEscalation({ active: true, supportedLevels: [], current: undefined, state: { saved: "medium", escalatedTo: "xhigh" } });
    expect(r.setLevel).toBeUndefined();
    expect(r.state).toEqual(NO_ESCALATION);
  });

  it("escalates from thinking-off when a goal starts", () => {
    const r = computeThinkingEscalation({ active: true, supportedLevels: LEVELS, current: "off", state: NO_ESCALATION });
    expect(r.setLevel).toBe("xhigh");
    expect(r.state).toEqual({ saved: "off", escalatedTo: "xhigh" });
  });
});
