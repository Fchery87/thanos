import { describe, expect, it } from "vitest";
import { roleOverrideFrom } from "../../src/goal/load-settings";

describe("roleOverrideFrom", () => {
  it("returns the active agentOverrides entry for the role", () => {
    const settings = {
      subagents: {
        modelOverridesEnabled: true,
        agentOverrides: { evaluator: { model: "theclawbay-claude/claude-sonnet-4-6:low", fallbackModels: ["theclawbay/gpt-5.4-mini"] } },
      },
    };
    expect(roleOverrideFrom(settings, "evaluator")).toEqual({
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
    expect(roleOverrideFrom(settings, "evaluator")).toBeUndefined();
  });

  it("returns undefined for missing role, malformed blocks, or non-object input", () => {
    expect(roleOverrideFrom({ subagents: { agentOverrides: {} } }, "evaluator")).toBeUndefined();
    expect(roleOverrideFrom({ subagents: { agentOverrides: { evaluator: { model: 42 } } } }, "evaluator")).toBeUndefined();
    expect(roleOverrideFrom(null, "evaluator")).toBeUndefined();
  });
});
