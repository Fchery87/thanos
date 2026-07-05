import { describe, expect, it } from "vitest";
import { evaluatorOverrideFrom } from "../../src/goal/load-settings";

describe("evaluatorOverrideFrom", () => {
  it("returns the active agentOverrides entry for the role", () => {
    const settings = {
      subagents: {
        modelOverridesEnabled: true,
        agentOverrides: { evaluator: { model: "theclawbay-claude/claude-sonnet-4-6:low", fallbackModels: ["theclawbay/gpt-5.4-mini"] } },
      },
    };
    expect(evaluatorOverrideFrom(settings, "evaluator")).toEqual({
      model: "theclawbay-claude/claude-sonnet-4-6:low",
      fallbackModels: ["theclawbay/gpt-5.4-mini"],
    });
  });

  it("ignores savedAgentOverrides — routing toggled off means session model", () => {
    const settings = {
      subagents: {
        modelOverridesEnabled: false,
        savedAgentOverrides: { evaluator: { model: "theclawbay-claude/claude-sonnet-4-6" } },
      },
    };
    expect(evaluatorOverrideFrom(settings, "evaluator")).toBeUndefined();
  });

  it("returns undefined for missing role, malformed blocks, or non-object input", () => {
    expect(evaluatorOverrideFrom({ subagents: { agentOverrides: {} } }, "evaluator")).toBeUndefined();
    expect(evaluatorOverrideFrom({ subagents: { agentOverrides: { evaluator: { model: 42 } } } }, "evaluator")).toBeUndefined();
    expect(evaluatorOverrideFrom(null, "evaluator")).toBeUndefined();
  });
});
