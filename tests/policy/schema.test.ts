import { describe, expect, it } from "vitest";
import { parsePolicy } from "../../src/policy/schema";

const validPolicy = {
  version: 1,
  preset: "team",
  rules: [
    {
      id: "custom-allow-env",
      capability: "read",
      pattern: ".env.local",
      decision: "allow",
      reason: "Project-specific exception",
    },
  ],
  audit: { enabled: true },
  headless: { defaultDecision: "deny" },
};

describe("parsePolicy", () => {
  it("accepts a valid policy and includes preset safeguards", () => {
    const parsed = parsePolicy(validPolicy);

    expect(parsed.preset).toBe("team");
    expect(parsed.rules.some((rule) => rule.id === "builtin-deny-env-read")).toBe(true);
  });

  it("rejects rules without stable ids", () => {
    expect(() => parsePolicy({
      ...validPolicy,
      rules: [
        {
          capability: "read",
          pattern: ".env*",
          decision: "deny",
          reason: "missing id",
        },
      ],
    })).toThrow(/id/i);
  });
});
