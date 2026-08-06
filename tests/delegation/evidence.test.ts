import { describe, expect, it } from "vitest";
import { validateDelegationEvidence } from "../../src/delegation/evidence";

const identity = { requestId: "request-1", ownerRunId: "session-1", nodeId: "node-1" };

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    ...identity,
    runId: "child-run-1",
    status: "completed",
    launchContractDigest: "a".repeat(64),
    execution: { status: "completed", success: true, exitCode: 0 },
    acceptance: { status: "accepted", evidenceStatus: "verified", explicit: true },
    review: { status: "reviewed", findings: [] },
    effects: { fileMutation: { status: "observed", expected: true, attempted: true } },
    artifacts: [{ kind: "patch", path: ".harness/patch.diff", sha256: "b".repeat(64) }],
    warnings: [],
    residualRisks: [],
    ...overrides,
  };
}

describe("validateDelegationEvidence", () => {
  it("accepts a complete identity-bound envelope", () => {
    expect(validateDelegationEvidence(envelope(), identity).state).toBe("accepted");
  });

  it("fails identity mismatch closed", () => {
    const verdict = validateDelegationEvidence(envelope({ nodeId: "other" }), identity);
    expect(verdict.state).toBe("awaiting_evidence");
    if (verdict.state === "awaiting_evidence") expect(verdict.reasons).toContain("nodeId does not match the workflow node");
  });

  it("does not treat an unpatched upstream response shape as completion", () => {
    const verdict = validateDelegationEvidence({
      ...identity,
      runId: "child-run-1",
      status: "completed",
      launchContractDigest: "a".repeat(64),
      result: { kind: "text", text: "done" },
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1, toolCalls: 0, durationMs: 1 },
    }, identity);
    expect(verdict.state).toBe("awaiting_evidence");
    if (verdict.state === "awaiting_evidence") {
      expect(verdict.reasons).toContain("acceptance evidence is missing");
      expect(verdict.reasons).toContain("artifact references must carry SHA-256 digests");
    }
  });

  it("accepts checked evidence but refuses weaker or rejected acceptance states", () => {
    // "checked" means the runtime executed the criteria and structural checks.
    for (const status of ["accepted", "verified", "reviewed", "checked"]) {
      const verdict = validateDelegationEvidence(
        envelope({ acceptance: { status, evidenceStatus: status, explicit: true } }),
        identity,
      );
      expect(verdict.state, `${status} should pass the gate`).toBe("accepted");
    }
    // Everything below a runtime-executed check stays closed — "attested" in
    // particular is only the child's own claim.
    for (const status of ["attested", "claimed", "pending", "not-required", "rejected", "review-required"]) {
      const verdict = validateDelegationEvidence(
        envelope({ acceptance: { status, evidenceStatus: status, explicit: true } }),
        identity,
      );
      expect(verdict.state, `${status} must not pass the gate`).toBe("awaiting_evidence");
      if (verdict.state === "awaiting_evidence") {
        expect(verdict.reasons).toContain("acceptance did not reach an accepted evidence state");
      }
    }
  });

  it("rejects blockers, missing effects, and undigested artifacts", () => {
    const verdict = validateDelegationEvidence(envelope({
      review: { status: "blockers" },
      effects: { fileMutation: { status: "missing", expected: true, attempted: false } },
      artifacts: [{ kind: "patch", path: "patch.diff" }],
    }), identity);
    expect(verdict.state).toBe("awaiting_evidence");
    if (verdict.state === "awaiting_evidence") {
      expect(verdict.reasons).toContain("review reported blockers");
      expect(verdict.reasons).toContain("required file mutation evidence is missing");
    }
  });
});
