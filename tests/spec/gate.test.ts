import { describe, expect, it } from "vitest";
import { buildContinuationPrompt, GATE_MAX_ATTEMPTS, gatedFailures, shouldReinject } from "../../src/spec/gate";
import type { VerificationResult } from "../../src/spec/verification";

const crit = (passed: boolean, missingEvidence: string[] = []): VerificationResult => ({
  criterion: { id: "c1", statement: "tests pass", evidenceRequired: ["test"] },
  passed,
  evidence: passed ? ["test passed"] : [],
  missingEvidence,
});

const advisoryCrit = (passed: boolean, missingEvidence: string[] = []): VerificationResult => ({
  criterion: { id: "audit-primary", statement: "audit findings supported by evidence", evidenceRequired: ["command"] },
  passed,
  advisory: true,
  evidence: passed ? ["ran a command"] : [],
  missingEvidence,
});

// A keyword-template criterion from buildTaskContract — gated in principle, but
// it describes no request in particular, so it must never force a continuation.
const templateCrit = (passed: boolean, missingEvidence: string[] = []): VerificationResult => ({
  criterion: {
    id: "build-primary",
    statement: "Requested code change is implemented in the relevant files",
    evidenceRequired: ["diff"],
    source: "deterministic_fallback",
  },
  passed,
  source: "deterministic_fallback",
  evidence: passed ? ["diff observed"] : [],
  missingEvidence,
});

const semanticCrit = (passed: boolean, missingEvidence: string[] = []): VerificationResult => ({
  criterion: {
    id: "extracted-1",
    statement: "gatedFailures ignores deterministic_fallback criteria",
    evidenceRequired: ["diff"],
    source: "semantic_extraction",
  },
  passed,
  source: "semantic_extraction",
  evidence: passed ? ["diff observed"] : [],
  missingEvidence,
});

describe("shouldReinject", () => {
  it("re-injects when a criterion fails and budget remains", () => {
    expect(shouldReinject({ results: [crit(false, ["test"])], attempts: 0, isSubagent: false, enabled: true, goalActive: false, specApproved: true })).toBe(true);
  });

  it("does not re-inject when all criteria pass", () => {
    expect(shouldReinject({ results: [crit(true)], attempts: 0, isSubagent: false, enabled: true, goalActive: false, specApproved: true })).toBe(false);
  });

  it("does not re-inject in a subagent", () => {
    expect(shouldReinject({ results: [crit(false, ["test"])], attempts: 0, isSubagent: true, enabled: true, goalActive: false, specApproved: true })).toBe(false);
  });

  it("stops once the attempt budget is exhausted", () => {
    expect(shouldReinject({ results: [crit(false, ["test"])], attempts: GATE_MAX_ATTEMPTS, isSubagent: false, enabled: true, goalActive: false, specApproved: true })).toBe(false);
  });

  it("is a no-op when disabled", () => {
    expect(shouldReinject({ results: [crit(false, ["test"])], attempts: 0, isSubagent: false, enabled: false, goalActive: false, specApproved: true })).toBe(false);
  });

  it("does not re-inject with no results (instant tier / no spec)", () => {
    expect(shouldReinject({ results: [], attempts: 0, isSubagent: false, enabled: true, goalActive: false, specApproved: true })).toBe(false);
  });

  it("does not re-inject while a goal is active (goal loop is the only driver)", () => {
    expect(shouldReinject({ results: [crit(false, ["test"])], attempts: 0, isSubagent: false, enabled: true, goalActive: true, specApproved: true })).toBe(false);
  });

  it("does not re-inject when the user aborted the turn (ESC must win)", () => {
    expect(shouldReinject({ results: [crit(false, ["test"])], attempts: 0, isSubagent: false, enabled: true, goalActive: false, aborted: true, specApproved: true })).toBe(false);
  });

  it("does not re-inject when the only failing criterion is advisory (audit/investigate)", () => {
    expect(shouldReinject({ results: [advisoryCrit(false, ["command"])], attempts: 0, isSubagent: false, enabled: true, goalActive: false, specApproved: true })).toBe(false);
  });

  it("still re-injects when a gated criterion fails alongside a failing advisory one", () => {
    expect(shouldReinject({ results: [advisoryCrit(false, ["command"]), crit(false, ["test"])], attempts: 0, isSubagent: false, enabled: true, goalActive: false, specApproved: true })).toBe(true);
  });

  // A user who declines the explicit-spec approval prompt has refused the work.
  // The gate must not treat the resulting absence of evidence as an unmet
  // criterion to overcome — that restarted the refused work on the next turn,
  // after clearSessionRules() had already dropped the rejection's global deny.
  it("never re-injects when the spec was not approved", () => {
    expect(shouldReinject({ results: [crit(false, ["test"])], attempts: 0, isSubagent: false, enabled: true, goalActive: false, specApproved: false })).toBe(false);
  });

  it("still re-injects for a spec that never needed approval (ambient tier)", () => {
    expect(shouldReinject({ results: [crit(false, ["test"])], attempts: 0, isSubagent: false, enabled: true, goalActive: false, specApproved: true })).toBe(true);
  });

  // The Phase 0 acceptance condition. Every one of the 739 recorded gate
  // failures looked exactly like this: a deterministic template with no
  // evidence, burning a full extra model turn.
  it("does not re-inject when every failing criterion is a deterministic template", () => {
    expect(shouldReinject({
      results: [templateCrit(false, ["diff"]), templateCrit(false, ["test"])],
      attempts: 0, isSubagent: false, enabled: true, goalActive: false, specApproved: true,
    })).toBe(false);
  });

  it("still re-injects when a semantic criterion fails alongside a deterministic one", () => {
    expect(shouldReinject({
      results: [templateCrit(false, ["diff"]), semanticCrit(false, ["diff"])],
      attempts: 0, isSubagent: false, enabled: true, goalActive: false, specApproved: true,
    })).toBe(true);
  });

  // Unknown provenance must fail toward gating: a future criterion source that
  // forgets to set `source` should keep the gate, not silently disarm it.
  it("still re-injects for a failing criterion with no recorded source", () => {
    expect(shouldReinject({
      results: [crit(false, ["test"])],
      attempts: 0, isSubagent: false, enabled: true, goalActive: false, specApproved: true,
    })).toBe(true);
  });
});

describe("gatedFailures", () => {
  // Anything describing what the gate DID must come from here. The harness ledger
  // previously recomputed it with a raw !passed filter and so recorded advisory
  // criteria as "re-injected" when the continuation prompt had excluded them —
  // and that ledger feeds the eval bench.
  it("excludes advisory criteria and passing ones", () => {
    const results = [crit(false, ["test"]), advisoryCrit(false, ["command"]), crit(true)];
    expect(gatedFailures(results).map((r) => r.criterion.id)).toEqual(["c1"]);
  });

  it("agrees with the continuation prompt about what is unmet", () => {
    const results = [advisoryCrit(false, ["command"]), crit(false, ["test"])];
    const prompt = buildContinuationPrompt(results, 0);

    for (const result of gatedFailures(results)) {
      expect(prompt).toContain(result.criterion.statement);
    }
    expect(prompt).not.toContain("audit findings supported by evidence");
  });

  it("is empty when only advisory criteria are unmet", () => {
    expect(gatedFailures([advisoryCrit(false, ["command"])])).toEqual([]);
  });

  it("excludes deterministic templates, keeping semantic criteria", () => {
    const results = [templateCrit(false, ["diff"]), semanticCrit(false, ["diff"]), crit(false, ["test"])];
    expect(gatedFailures(results).map((r) => r.criterion.id)).toEqual(["extracted-1", "c1"]);
  });

  it("keeps the continuation prompt free of deterministic templates", () => {
    const prompt = buildContinuationPrompt([templateCrit(false, ["diff"]), semanticCrit(false, ["diff"])], 0);
    expect(prompt).toContain("gatedFailures ignores deterministic_fallback criteria");
    expect(prompt).not.toContain("Requested code change is implemented");
  });
});

describe("buildContinuationPrompt", () => {
  it("lists only the unmet criteria and carries the sentinel", () => {
    const prompt = buildContinuationPrompt([crit(false, ["test"]), {
      criterion: { id: "c2", statement: "docs updated", evidenceRequired: ["diff"] },
      passed: true,
      evidence: ["diff observed"],
      missingEvidence: [],
    }], 1);

    expect(prompt).toContain("[harness:verify-continue]");
    expect(prompt).toContain("tests pass");
    expect(prompt).not.toContain("docs updated");
    expect(prompt).toContain("attempt 2");
    expect(prompt.toLowerCase()).toContain("do not stop");
  });
});
