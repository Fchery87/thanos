import { describe, expect, it } from "vitest";
import {
  buildDirective, buildFirstDirective, buildEvaluatorContext,
  EVALUATOR_SYSTEM, GOAL_DIRECTIVE_SENTINEL,
} from "../../src/goal/prompts";

describe("goal directives", () => {
  it("every directive starts with the goal sentinel", () => {
    expect(buildFirstDirective("all tests pass").startsWith(GOAL_DIRECTIVE_SENTINEL)).toBe(true);
    expect(buildDirective("all tests pass", "2 failing").startsWith(GOAL_DIRECTIVE_SENTINEL)).toBe(true);
  });

  it("continuation directive includes condition, reason, and an evidence nudge", () => {
    const d = buildDirective("all tests pass", "2 failing in auth");
    expect(d).toContain("all tests pass");
    expect(d).toContain("2 failing in auth");
    expect(d).toMatch(/evidence/i);
  });

  it("directives explain the checker's blindness so the worker surfaces evidence every turn", () => {
    for (const d of [buildFirstDirective("cond"), buildDirective("cond", "reason")]) {
      expect(d).toMatch(/cannot run tools/i);
      expect(d).toMatch(/final (message|reply)/i);
      expect(d).toMatch(/every (reply|turn)/i);
    }
  });
});

describe("buildEvaluatorContext", () => {
  it("puts condition + last turn window in the user message, no tools", () => {
    const ctx = buildEvaluatorContext({
      condition: "tests pass",
      lastAssistantText: "ran npm test, 0 failures",
      toolResultsText: "exit 0",
      previousReason: "was 1 failing",
    });
    expect(ctx.systemPrompt).toBe(EVALUATOR_SYSTEM);
    expect(ctx.tools).toBeUndefined();
    expect(ctx.messages).toHaveLength(1);
    const body = ctx.messages[0].content as string;
    expect(body).toContain("tests pass");
    expect(body).toContain("0 failures");
    expect(body).toContain("exit 0");
    expect(body).toContain("was 1 failing");
  });

  it("forces the VERDICT/REASON protocol in the system prompt", () => {
    expect(EVALUATOR_SYSTEM).toContain("VERDICT:");
    expect(EVALUATOR_SYSTEM).toContain("REASON:");
  });
});
