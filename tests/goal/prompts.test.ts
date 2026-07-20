import { describe, expect, it } from "vitest";
import {
  buildFirstDirective, buildContinueDirective, buildEvaluatorContext, buildGoalSystemPrompt,
  EVALUATOR_SYSTEM, GOAL_DIRECTIVE_SENTINEL,
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

  it("the first directive explains the checker's blindness so the worker surfaces evidence", () => {
    const d = buildFirstDirective("cond");
    expect(d).toMatch(/cannot run tools/i);
    expect(d).toMatch(/final (message|reply)/i);
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

  it("restates the evidence contract because the judge is tool-less", () => {
    const s = buildGoalSystemPrompt("cond");
    expect(s).toMatch(/cannot run tools/i);
    expect(s).toMatch(/final (message|reply)/i);
  });

  it("is not a follow-up directive — carries no goal sentinel", () => {
    expect(buildGoalSystemPrompt("cond").includes(GOAL_DIRECTIVE_SENTINEL)).toBe(false);
  });
});

describe("buildEvaluatorContext", () => {
  it("puts condition + last turn window in the user message, no tools", () => {
    const ctx = buildEvaluatorContext({
      condition: "tests pass",
      assistantClaim: "ran npm test, 0 failures",
      toolResultsText: "exit 0",
      previousReason: "was 1 failing",
    });
    expect(ctx.systemPrompt).toBe(EVALUATOR_SYSTEM);
    expect(ctx.tools).toBeUndefined();
    expect(ctx.messages).toHaveLength(1);
    const body = ctx.messages[0].content as string;
    expect(body).toContain('"condition"');
    expect(body).toContain("tests pass");
    expect(body).toContain("0 failures");
    expect(body).toContain("exit 0");
    expect(body).toContain("was 1 failing");
    expect(body).toContain('"source":"goal.assistantClaim"');
  });

  it("forces the VERDICT/REASON protocol in the system prompt", () => {
    expect(EVALUATOR_SYSTEM).toContain("VERDICT:");
    expect(EVALUATOR_SYSTEM).toContain("REASON:");
  });
});
