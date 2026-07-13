import { describe, expect, it } from "vitest";
import { roleNarrowingOverlay } from "../../src/governance/role-overlay";

function capabilities(rules: { capability: string }[]): string[] {
  return rules.map((r) => r.capability).sort();
}

describe("roleNarrowingOverlay", () => {
  it("returns no rules for an undefined role (parent sessions)", () => {
    expect(roleNarrowingOverlay(undefined)).toEqual([]);
  });

  it("returns no rules for a role this harness doesn't recognize", () => {
    expect(roleNarrowingOverlay("some-future-role")).toEqual([]);
  });

  it("returns no rules for writer roles — the base policy ceiling applies unchanged", () => {
    for (const role of ["build", "worker", "scout"]) {
      expect(roleNarrowingOverlay(role)).toEqual([]);
    }
  });

  describe("read-only roles deny both edit and exec", () => {
    const readOnlyRoles = ["explore", "plan", "oracle", "researcher", "reviewer", "reviewer-correctness", "reviewer-security", "reviewer-tests"];

    it.each(readOnlyRoles)("denies edit and exec for %s", (role) => {
      const rules = roleNarrowingOverlay(role);
      expect(capabilities(rules)).toEqual(["edit", "exec"]);
      for (const rule of rules) {
        expect(rule.decision).toBe("deny");
        expect(rule.reason).toContain(role);
      }
    });
  });

  it("evaluator: denies edit but not exec (may re-run tests, never edits)", () => {
    const rules = roleNarrowingOverlay("evaluator");
    expect(capabilities(rules)).toEqual(["edit"]);
    expect(rules[0].decision).toBe("deny");
  });

  it("designer: denies exec but not edit (builds UI files, never runs commands)", () => {
    const rules = roleNarrowingOverlay("designer");
    expect(capabilities(rules)).toEqual(["exec"]);
    expect(rules[0].decision).toBe("deny");
  });

  it("every returned rule has a unique id", () => {
    const allRoles = ["explore", "plan", "oracle", "researcher", "reviewer", "reviewer-correctness", "reviewer-security", "reviewer-tests", "evaluator", "designer"];
    for (const role of allRoles) {
      const rules = roleNarrowingOverlay(role);
      const ids = rules.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
