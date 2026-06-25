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

  it("denies `git push -u origin HEAD`", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall("bash", { command: "git push -u origin HEAD" }, policy);
    expect(result.policyDecision?.decision).toBe("deny");
  });

  // Clause-split deny: a chained command must not slip past the push deny.
  it("denies a chained `cd repo && git push` via clause splitting", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall("bash", { command: "cd repo && git push" }, policy);
    expect(result.policyDecision?.decision).toBe("deny");
  });

  it("denies a chained `git status && git push origin main` via clause splitting", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall(
      "bash",
      { command: "git status && git push origin main" },
      policy,
    );
    expect(result.policyDecision?.decision).toBe("deny");
  });

  // Anchored patterns fix the prior false positive: a commit message that
  // merely mentions "push" must NOT be denied.
  it('does NOT deny `git commit -m "add push support"`', () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall(
      "bash",
      { command: 'git commit -m "add push support"' },
      policy,
    );
    expect(result.policyDecision).toBeNull();
  });

  it("does NOT deny benign commands under the overlay", () => {
    const policy = policyWithOverlay("local-only");
    expect(evaluateGovernedToolCall("bash", { command: "git status" }, policy).policyDecision).toBeNull();
    expect(evaluateGovernedToolCall("bash", { command: "ls -la" }, policy).policyDecision).toBeNull();
    expect(evaluateGovernedToolCall("bash", { command: "cat src/push.ts" }, policy).policyDecision).toBeNull();
    expect(evaluateGovernedToolCall("bash", { command: "npm run build" }, policy).policyDecision).toBeNull();
    expect(evaluateGovernedToolCall("bash", { command: "bun run test" }, policy).policyDecision).toBeNull();
  });

  it("does NOT deny a similarly-named non-push command (git pushy)", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall("bash", { command: "git pushy origin" }, policy);
    expect(result.policyDecision).toBeNull();
  });

  // ACCEPTED LIMITATION (NOT desired behavior): the patterns anchor on
  // `git push` at the clause start, so ANY `git <flags> push` form bypasses the
  // deny — regardless of whether the flag value contains a slash. Catching it
  // would require a broad pattern that re-introduces the commit-message false
  // positive. Documented in delivery-overlay.ts. These tests pin the true blast
  // radius so a future change to the deny patterns surfaces it.
  it("does NOT deny `git -C /abs/path push` — absolute path (accepted limitation, not desired)", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall("bash", { command: "git -C /repo push origin HEAD" }, policy);
    expect(result.policyDecision).toBeNull();
  });

  it("does NOT deny `git -C subdir push` — relative path, no slash (accepted limitation, not desired)", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall("bash", { command: "git -C subdir push origin" }, policy);
    expect(result.policyDecision).toBeNull();
  });

  // gh publish family: local-only must also block publishing to a remote via
  // the GitHub CLI (pr/release/repo create), anchored at clause start.
  it("denies `gh pr create --fill`", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall("bash", { command: "gh pr create --fill" }, policy);
    expect(result.policyDecision?.decision).toBe("deny");
  });

  it("denies `gh release create v1.0`", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall("bash", { command: "gh release create v1.0" }, policy);
    expect(result.policyDecision?.decision).toBe("deny");
  });

  it("denies `gh repo create foo --public`", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall(
      "bash",
      { command: "gh repo create foo --public" },
      policy,
    );
    expect(result.policyDecision?.decision).toBe("deny");
  });

  it("denies a chained `cd repo && gh pr create --fill` via clause splitting", () => {
    const policy = policyWithOverlay("local-only");
    const result = evaluateGovernedToolCall(
      "bash",
      { command: "cd repo && gh pr create --fill" },
      policy,
    );
    expect(result.policyDecision?.decision).toBe("deny");
  });

  // Anchoring keeps benign gh reads allowed — these must NOT be denied.
  it("does NOT deny benign gh read commands (pr view/list, repo view, release list)", () => {
    const policy = policyWithOverlay("local-only");
    expect(
      evaluateGovernedToolCall("bash", { command: "gh pr view 12" }, policy).policyDecision,
    ).toBeNull();
    expect(
      evaluateGovernedToolCall("bash", { command: "gh pr list" }, policy).policyDecision,
    ).toBeNull();
    expect(
      evaluateGovernedToolCall("bash", { command: "gh repo view" }, policy).policyDecision,
    ).toBeNull();
    expect(
      evaluateGovernedToolCall("bash", { command: "gh release list" }, policy).policyDecision,
    ).toBeNull();
    // repo clone is read-ish (fetching, not publishing) — must stay allowed.
    expect(
      evaluateGovernedToolCall("bash", { command: "gh repo clone owner/x" }, policy).policyDecision,
    ).toBeNull();
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
