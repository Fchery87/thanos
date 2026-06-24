import { describe, expect, it } from "vitest";
import { deliveryPolicyOverlay, presetForMode } from "../../src/governance/delivery-overlay";
import { evaluateGovernedToolCall } from "../../src/governance/tool-call";
import { getPresetPolicy } from "../../src/policy/presets";
import type { HarnessPolicy } from "../../src/policy/types";

describe("presetForMode", () => {
  it("maps no-mistakes to ci", () => {
    expect(presetForMode("no-mistakes")).toBe("ci");
  });
  it("maps direct-PR to team", () => {
    expect(presetForMode("direct-PR")).toBe("team");
  });
  it("maps local-only to personal", () => {
    expect(presetForMode("local-only")).toBe("personal");
  });
});

describe("deliveryPolicyOverlay deny shape", () => {
  it("direct-PR adds no rules", () => {
    expect(deliveryPolicyOverlay("direct-PR")).toEqual([]);
  });

  it("no-mistakes adds no rules", () => {
    expect(deliveryPolicyOverlay("no-mistakes")).toEqual([]);
  });

  it("local-only adds at least one exec deny with a stable id", () => {
    const rules = deliveryPolicyOverlay("local-only");
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.capability === "exec" && r.decision === "deny")).toBe(true);
    expect(rules.map((r) => r.id)).toContain("delivery-local-only-no-push");
  });
});

/**
 * Build a base policy with the overlay prepended (mirrors narrowPolicyForAgent:
 * deny rules go first so they win on first match).
 */
function policyWithOverlay(mode: Parameters<typeof deliveryPolicyOverlay>[0]): HarnessPolicy {
  const base = getPresetPolicy("personal");
  return { ...base, rules: [...deliveryPolicyOverlay(mode), ...base.rules] };
}

describe("local-only overlay denies git push end-to-end through the evaluator", () => {
  it("denies a plain `git push origin main`", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall("bash", { command: "git push origin main" }, policy);
    expect(result.policyDecision?.decision).toBe("deny");
  });

  it("denies a bare `git push`", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall("bash", { command: "git push" }, policy);
    expect(result.policyDecision?.decision).toBe("deny");
  });

  it("denies `git push` with intervening flags (git -C dir push)", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall("bash", { command: "git -C /repo push origin HEAD" }, policy);
    expect(result.policyDecision?.decision).toBe("deny");
  });

  it("does NOT deny benign commands under the overlay", () => {
    const policy = policyWithOverlay("local-only");
    expect(evaluateGovernedToolCall("bash", { command: "git status" }, policy).policyDecision).toBeNull();
    expect(evaluateGovernedToolCall("bash", { command: "ls -la" }, policy).policyDecision).toBeNull();
  });

  it("does NOT deny a similarly-named non-push command (git pushy)", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall("bash", { command: "git pushy origin" }, policy);
    expect(result.policyDecision).toBeNull();
  });

  it("direct-PR overlay does NOT deny git push", () => {
    const policy = policyWithOverlay("direct-PR");
    const result = evaluateGovernedToolCall("bash", { command: "git push origin main" }, policy);
    expect(result.policyDecision).toBeNull();
  });

  it("no-mistakes overlay does NOT deny git push", () => {
    const policy = policyWithOverlay("no-mistakes");
    const result = evaluateGovernedToolCall("bash", { command: "git push origin main" }, policy);
    expect(result.policyDecision).toBeNull();
  });
});
