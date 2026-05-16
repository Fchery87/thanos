import { describe, expect, it } from "vitest";
import { narrowPolicyForAgent } from "../../src/agents/policy";
import { evaluatePolicy } from "../../src/policy/evaluator";
import type { HarnessPolicy } from "../../src/policy/types";

const basePolicy: HarnessPolicy = {
  version: 1,
  preset: "personal",
  rules: [],
  audit: { enabled: false },
  headless: { defaultDecision: "ask" },
};

describe("narrowPolicyForAgent", () => {
  describe("designer", () => {
    it("denies exec capability", () => {
      const narrowed = narrowPolicyForAgent("designer", basePolicy);
      const result = evaluatePolicy(narrowed, "exec", "somecommand");
      expect(result).not.toBeNull();
      expect(result?.decision).toBe("deny");
      expect(result?.ruleId).toBe("agent-deny-exec");
    });

    it("does not deny edit capability (returns null — falls through)", () => {
      const narrowed = narrowPolicyForAgent("designer", basePolicy);
      const result = evaluatePolicy(narrowed, "edit", "somefile.ts");
      expect(result).toBeNull();
    });
  });

  describe("read-only agents (explore, plan, reviewer)", () => {
    it.each(["explore", "plan", "reviewer"] as const)("%s cannot exec", (type) => {
      const narrowed = narrowPolicyForAgent(type, basePolicy);
      const result = evaluatePolicy(narrowed, "exec", "somecommand");
      expect(result).not.toBeNull();
      expect(result?.decision).toBe("deny");
    });

    it.each(["explore", "plan", "reviewer"] as const)("%s cannot edit", (type) => {
      const narrowed = narrowPolicyForAgent(type, basePolicy);
      const result = evaluatePolicy(narrowed, "edit", "somefile.ts");
      expect(result).not.toBeNull();
      expect(result?.decision).toBe("deny");
    });
  });

  describe("build", () => {
    it("gets full parent policy with no narrowing", () => {
      const narrowed = narrowPolicyForAgent("build", basePolicy);
      expect(narrowed).toStrictEqual(basePolicy);
    });

    it("does not deny exec", () => {
      const narrowed = narrowPolicyForAgent("build", basePolicy);
      const result = evaluatePolicy(narrowed, "exec", "somecommand");
      expect(result).toBeNull();
    });

    it("does not deny edit", () => {
      const narrowed = narrowPolicyForAgent("build", basePolicy);
      const result = evaluatePolicy(narrowed, "edit", "somefile.ts");
      expect(result).toBeNull();
    });
  });
});
