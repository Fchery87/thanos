import { describe, expect, it } from "vitest";
import { generateSpec } from "../../src/spec/generator";
import { verifyCriteria } from "../../src/spec/verification";
import { shouldReinject, GATE_MAX_ATTEMPTS } from "../../src/spec/gate";
import type { EvidenceRecord } from "../../src/spec/claims";

/**
 * Regression: an ambient audit/investigate prompt used to be unsatisfiable —
 * the deterministic contract required `manual` evidence (which the runtime agent
 * cannot emit) plus a command matching the literal executable "bash" (which
 * `normalizeExecutable` never produces). The verify gate then re-injected up to
 * GATE_MAX_ATTEMPTS times, so a plain "audit" prompt always burned 4 model turns.
 *
 * These tests pin BOTH directions: audits no longer loop, and a mutating task
 * with unmet, machine-verifiable criteria still does.
 */
const gate = (results: ReturnType<typeof verifyCriteria>) =>
  shouldReinject({ results, attempts: 0, isSubagent: false, enabled: true, goalActive: false });

describe("audit/investigate fast lane", () => {
  it("does not re-inject on the exact audit prompt even with zero evidence", () => {
    const spec = generateSpec("do an honest audit of my Pi + Thanos harness", "ambient");
    const results = verifyCriteria(spec, []);

    expect(results.every((result) => result.advisory)).toBe(true);
    expect(gate(results)).toBe(false);
  });

  it("does not re-inject an investigation across the whole attempt budget", () => {
    const spec = generateSpec("investigate why the billing worker hangs in CI", "ambient");
    const results = verifyCriteria(spec, []);

    for (let attempts = 0; attempts <= GATE_MAX_ATTEMPTS; attempts++) {
      expect(shouldReinject({ results, attempts, isSubagent: false, enabled: true, goalActive: false })).toBe(false);
    }
  });

  it("marks the audit criterion satisfied once any command corroborates it", () => {
    const spec = generateSpec("audit the auth flow", "ambient");
    const evidence: EvidenceRecord[] = [
      { kind: "command", family: "", normalizedExecutable: "rg", argv: ["rg", "token", "src/auth"], exitCode: 0, passed: true },
    ];
    const results = verifyCriteria(spec, evidence);

    expect(results.some((result) => result.criterion.id === "audit-primary" && result.passed)).toBe(true);
    expect(gate(results)).toBe(false);
  });

  it("still re-injects a mutating task whose gated criteria are unmet (same empty-evidence input)", () => {
    const spec = generateSpec("implement the parser module and add tests", "ambient");
    const results = verifyCriteria(spec, []);

    expect(results.some((result) => !result.advisory && !result.passed)).toBe(true);
    expect(gate(results)).toBe(true);
  });
});
