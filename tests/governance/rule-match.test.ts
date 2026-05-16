import { describe, expect, it } from "vitest";
import { matchesPattern, matchGlob } from "../../src/governance/rule-match";
import { evaluateRules, type PermissionRule } from "../../src/permissions/rules";
import { evaluatePolicy } from "../../src/policy/evaluator";
import type { HarnessPolicy } from "../../src/policy/types";

describe("rule matching", () => {
  it("matches simple globs", () => {
    expect(matchGlob("src/*.ts", "src/index.ts")).toBe(true);
  });

  it("does not match a pattern against an unrelated containing string (no substring fallback)", () => {
    expect(matchesPattern("foo", "prefix-foo-suffix")).toBe(false);
    expect(matchesPattern("foo", "prefix-bar-suffix")).toBe(false);
  });
});

describe("basename pattern matching via minimatch", () => {
  it("matches .env* against a nested .env file by basename", () => {
    expect(matchesPattern(".env*", "apps/web/.env")).toBe(true);
  });

  it("matches .env* against .env.local in a subdirectory", () => {
    expect(matchesPattern(".env*", "server/.env.local")).toBe(true);
  });

  it("matches .env* against a top-level .env file", () => {
    expect(matchesPattern(".env*", ".env")).toBe(true);
  });

  it("does not match .env* against a file whose name merely contains env", () => {
    expect(matchesPattern(".env*", "src/environment.ts")).toBe(false);
  });

  it("matches **/*.pem against a nested certificate file", () => {
    expect(matchesPattern("**/*.pem", "certs/server.pem")).toBe(true);
  });

  it("matches **/id_rsa* against a nested SSH key", () => {
    expect(matchesPattern("**/id_rsa*", ".ssh/id_rsa")).toBe(true);
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

  it("builtin sensitive deny fires even when a user allow-all rule is the only rule in policy.rules", () => {
    const policy: HarnessPolicy = {
      version: 1,
      preset: "team",
      rules: [
        { id: "user-allow-all", capability: "read", pattern: "**/*", decision: "allow", reason: "relax all reads" },
      ],
      audit: { enabled: false },
      headless: { defaultDecision: "deny" },
    };

    const result = evaluatePolicy(policy, "read", "apps/web/.env");
    expect(result?.decision).toBe("deny");
    expect(result?.ruleId).toMatch(/builtin/);
  });

  it("builtin sensitive deny fires for nested .env even when no policy rule covers it", () => {
    const policy: HarnessPolicy = {
      version: 1,
      preset: "team",
      rules: [],
      audit: { enabled: false },
      headless: { defaultDecision: "deny" },
    };

    const result = evaluatePolicy(policy, "read", "packages/api/.env.production");
    expect(result?.decision).toBe("deny");
  });
});
