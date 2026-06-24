import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../../src/policy/evaluator";
import type { HarnessPolicy, PolicyRule } from "../../src/policy/types";

function policyWith(rules: PolicyRule[]): HarnessPolicy {
  return {
    version: 1,
    preset: "personal",
    rules,
    audit: { enabled: false },
    headless: { defaultDecision: "deny" },
  };
}

const denyPush: PolicyRule = {
  id: "deny-push",
  capability: "exec",
  pattern: "git push *",
  decision: "deny",
  reason: "no push",
};

describe("evaluatePolicy clause-split deny (additive, exec only)", () => {
  it("denies a chained exec command via clause splitting", () => {
    const policy = policyWith([denyPush]);
    // Whole string `cd repo && git push origin` does not match `git push *`,
    // but the `git push origin` clause does.
    expect(evaluatePolicy(policy, "exec", "cd repo && git push origin").decision).toBe("deny");
  });

  it("still denies the whole-string match (unchanged behavior)", () => {
    const policy = policyWith([denyPush]);
    expect(evaluatePolicy(policy, "exec", "git push origin main").decision).toBe("deny");
  });

  it("returns null when no clause matches", () => {
    const policy = policyWith([denyPush]);
    expect(evaluatePolicy(policy, "exec", "cd repo && git status")).toBeNull();
  });

  it("does NOT apply clause splitting to non-exec capabilities", () => {
    // A read rule whose pattern would match a clause must not be triggered by
    // splitting a multi-token read target — non-exec is left exactly as today.
    const readRule: PolicyRule = {
      id: "deny-read-clause",
      capability: "read",
      pattern: "secret",
      decision: "deny",
      reason: "x",
    };
    const policy = policyWith([readRule]);
    // Whole-string read target containing a shell operator is NOT split.
    expect(evaluatePolicy(policy, "read", "notes && secret")).toBeNull();
    // Direct whole-string match still works.
    expect(evaluatePolicy(policy, "read", "secret").decision).toBe("deny");
  });

  it("is purely additive: a non-deny clause never overrides a whole-string allow", () => {
    const allowAll: PolicyRule = {
      id: "allow-exec",
      capability: "exec",
      pattern: "echo *",
      decision: "allow",
      reason: "ok",
    };
    const policy = policyWith([allowAll]);
    // Whole string matches allow; no clause yields a deny, so allow stands.
    expect(evaluatePolicy(policy, "exec", "echo hi").decision).toBe("allow");
  });

  it("a whole-string deny short-circuits before clause evaluation", () => {
    const policy = policyWith([denyPush]);
    const result = evaluatePolicy(policy, "exec", "git push origin");
    expect(result.decision).toBe("deny");
    expect(result.ruleId).toBe("deny-push");
  });
});
