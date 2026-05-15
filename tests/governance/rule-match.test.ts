import { describe, expect, it } from "vitest";
import { matchesPattern, matchGlob } from "../../src/governance/rule-match";
import { evaluateRules, type PermissionRule } from "../../src/permissions/rules";
import { evaluatePolicy } from "../../src/policy/evaluator";
import type { HarnessPolicy } from "../../src/policy/types";

describe("rule matching", () => {
  it("matches simple globs", () => {
    expect(matchGlob("src/*.ts", "src/index.ts")).toBe(true);
  });

  it("keeps substring fallback explicit", () => {
    expect(matchesPattern("foo", "prefix-foo-suffix")).toBe(true);
    expect(matchesPattern("foo", "prefix-bar-suffix")).toBe(false);
  });
});

describe("evaluateRules", () => {
  it("keeps last matching session rule winning", () => {
    const rules = [
      { capability: "read", decision: "allow", source: "session", pattern: "src/" },
      { capability: "read", decision: "deny", source: "session", pattern: "src/" },
    ] satisfies PermissionRule[];

    expect(evaluateRules(rules, "read", "src/index.ts")).toBe("deny");
  });
});

describe("evaluatePolicy", () => {
  it("returns the first matching policy rule and its id", () => {
    const policy: HarnessPolicy = {
      version: 1,
      preset: "team",
      rules: [
        { id: "first", capability: "read", pattern: "src/", decision: "allow", reason: "first" },
        { id: "second", capability: "read", pattern: "src/", decision: "deny", reason: "second" },
      ],
      audit: { enabled: false },
      headless: { defaultDecision: "deny" },
    };

    expect(evaluatePolicy(policy, "read", "src/index.ts")).toEqual({ decision: "allow", ruleId: "first", pattern: "src/" });
  });
});
