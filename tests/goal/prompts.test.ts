import { describe, expect, it } from "vitest";
import {
  buildFirstDirective, buildContinueDirective, buildGoalSystemPrompt,
  GOAL_DIRECTIVE_SENTINEL,
} from "../../src/goal/prompts";

describe("goal directives", () => {
  it("every directive starts with the goal sentinel", () => {
    expect(buildFirstDirective("all tests pass").startsWith(GOAL_DIRECTIVE_SENTINEL)).toBe(true);
    expect(buildContinueDirective().startsWith(GOAL_DIRECTIVE_SENTINEL)).toBe(true);
  });

  it("buildFirstDirective includes the condition and the completion protocol", () => {
    const d = buildFirstDirective("all tests pass");
    expect(d).toContain("all tests pass");
    expect(d).toContain("goal_complete");
    expect(d).toMatch(/evidence/i);
  });

  it("buildContinueDirective is terse — points at goal_complete and defers framing to the system prompt", () => {
    const d = buildContinueDirective();
    expect(d.startsWith(GOAL_DIRECTIVE_SENTINEL)).toBe(true);
    expect(d).toContain("goal_complete");
    expect(d).toMatch(/system prompt/i);
    // The condition and full evidence contract live in the system prompt now,
    // so the per-turn directive must NOT re-send them (token-growth guard).
    expect(d).not.toMatch(/cannot run tools/i);
  });

  it("buildFirstDirective points the agent at goal_complete", () => {
    expect(buildFirstDirective("cond")).toContain("goal_complete");
  });

  it("the first directive explains that SpecEngine decides the completion claim", () => {
    const d = buildFirstDirective("cond");
    expect(d).toMatch(/SpecEngine/i);
    expect(d).toMatch(/Work Contract/i);
    expect(d).toMatch(/goal_complete/i);
  });
});

describe("buildGoalSystemPrompt", () => {
  it("embeds the condition and forbids stopping at a plan/partial work", () => {
    const s = buildGoalSystemPrompt("all tests pass");
    expect(s).toContain("all tests pass");
    expect(s).toMatch(/do not stop/i);
    expect(s).toMatch(/plan/i);
  });

  it("restates the SpecEngine evidence contract", () => {
    const s = buildGoalSystemPrompt("cond");
    expect(s).toMatch(/SpecEngine/i);
    expect(s).toMatch(/Work Contract/i);
  });

  it("is not a follow-up directive — carries no goal sentinel", () => {
    expect(buildGoalSystemPrompt("cond").includes(GOAL_DIRECTIVE_SENTINEL)).toBe(false);
  });
});
