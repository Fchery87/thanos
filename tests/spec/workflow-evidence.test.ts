import { describe, expect, it } from "vitest";
import { SpecEngine } from "../../src/spec/engine";
import type { DelegationEvidenceEnvelope } from "../../src/delegation/evidence";
import type { WavePlan } from "../../src/workflows/types";

const plan: WavePlan = {
  id: "wave-1",
  goal: "implement billing",
  maxConcurrency: 1,
  integration: {
    targetRoots: ["src/billing"],
    capabilities: ["read", "edit", "exec"],
    criteria: [{
      id: "billing-implementation",
      statement: "The billing behavior is implemented and verified",
      evidenceRequired: ["diff", "test"],
    }],
    limits: { maxIntegrationTurns: 12, maxJuryRounds: 3 },
  },
  nodes: [{
    id: "investigate",
    agent: "explore",
    task: "inspect billing",
    dependsOn: [],
    required: true,
  }],
};

const envelope: DelegationEvidenceEnvelope = {
  version: 2,
  requestId: "request-1",
  ownerRunId: "owner-1",
  nodeId: "investigate",
  runId: "child-1",
  status: "completed",
  launchContractDigest: "a".repeat(64),
  execution: { status: "completed", success: true, exitCode: 0 },
  acceptance: { status: "verified", evidenceStatus: "verified", explicit: true },
  review: { status: "reviewed" },
  effects: {
    fileMutation: { status: "observed", expected: true, attempted: true },
  },
  artifacts: [{ kind: "patch", path: ".harness/patch.diff", sha256: "b".repeat(64) }],
  warnings: [],
  residualRisks: [],
};

describe("workflow evidence reaches SpecEngine with provenance", () => {
  it("binding a plan changes the Work Contract and adds a default-fail workflow criterion", () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement billing changes", true);
    const before = spec.workContractRevision;

    spec.bindWorkflowPlan(plan);

    expect(spec.workContractRevision).not.toBe(before);
    expect(spec.activeSpec?.targetFiles).toEqual(["src/billing"]);
    expect(spec.activeSpec?.allowedCapabilities).toEqual(["read", "edit", "exec"]);
    expect(spec.verify().find((result) => result.criterion.id === "integration:billing-implementation"))
      .toMatchObject({ passed: false, missingEvidence: ["diff", "test"] });
    expect(spec.verify().find((result) => result.criterion.id === "workflow:wave-1")).toMatchObject({
      passed: false,
      missingEvidence: ["workflow"],
    });
  });

  it("accepts workflow completion only from accepted provenance-bound node envelopes", () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement billing changes", true);
    spec.bindWorkflowPlan(plan);

    spec.recordWorkflowEvidenceRefs(plan, [{
      nodeId: "investigate",
      requestId: envelope.requestId,
      ownerRunId: envelope.ownerRunId,
      runId: envelope.runId,
      launchContractDigest: envelope.launchContractDigest,
      artifacts: envelope.artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
    }], { accepted: true, reasons: [] });

    expect(spec.verify().find((result) => result.criterion.id === "workflow:wave-1")).toMatchObject({
      passed: true,
      evidence: [expect.stringContaining("owner-1")],
    });
  });

  it("reconstructs workflow acceptance from journaled evidence references", () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement billing changes", true);
    spec.bindWorkflowPlan(plan);

    spec.recordWorkflowEvidenceRefs(plan, [{
      nodeId: "investigate",
      requestId: "request-1",
      ownerRunId: "owner-1",
      runId: "child-1",
      launchContractDigest: "a".repeat(64),
      artifacts: [{ path: ".harness/report.json", sha256: "b".repeat(64) }],
    }], { accepted: true, reasons: [] });

    expect(spec.verify().find((result) => result.criterion.id === "workflow:wave-1"))
      .toMatchObject({ passed: true, evidence: [expect.stringContaining("owner-1")] });
  });

  it("records a non-complete workflow as failed evidence", () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement billing changes", true);
    spec.bindWorkflowPlan(plan);

    spec.recordWorkflowEvidenceRefs(
      plan,
      [],
      { accepted: false, reasons: ["investigate: missing review"] },
    );

    expect(spec.verify().find((result) => result.criterion.id === "workflow:wave-1")?.passed).toBe(false);
  });
});
