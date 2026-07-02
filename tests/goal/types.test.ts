import { describe, expect, it } from "vitest";
import { DEFAULT_GOAL_SETTINGS, resolveGoalSettings } from "../../src/goal/types";

describe("goal settings", () => {
  it("has the approved defaults", () => {
    expect(DEFAULT_GOAL_SETTINGS).toEqual({
      maxTurns: 25, maxTokens: 0, checkpointEvery: 0, evaluatorRole: "evaluator",
    });
  });

  it("merges partial overrides onto defaults", () => {
    expect(resolveGoalSettings({ maxTurns: 5 })).toMatchObject({ maxTurns: 5, maxTokens: 0 });
  });

  it("treats undefined as all-defaults", () => {
    expect(resolveGoalSettings(undefined)).toEqual(DEFAULT_GOAL_SETTINGS);
  });
});
