import { describe, expect, it, vi } from "vitest";
import { handleWorkflowAgentEnd } from "../../src/workflows/agent-end";
import { WorkflowRuntime } from "../../src/workflows/state";
import type { WavePlan, WorkflowRunResult } from "../../src/workflows/types";
import type { VerificationResult } from "../../src/spec/verification";

const plan: WavePlan = {
  id: "wave",
  goal: "implement",
  maxConcurrency: 1,
  integration: {
    targetRoots: ["src"],
    capabilities: ["read", "edit", "exec"],
    criteria: [{ id: "done", statement: "Done", evidenceRequired: ["diff", "test"] }],
    limits: { maxIntegrationTurns: 3, maxJuryRounds: 2 },
  },
  nodes: [{ id: "inspect", agent: "explore", task: "inspect", dependsOn: [], required: true }],
};

function integrating(mode: "standalone" | "goal_attached" = "standalone"): WorkflowRuntime {
  const runtime = new WorkflowRuntime({ createId: () => "workflow-1", now: () => 42 });
  runtime.start({ goal: "implement", mode });
  runtime.bindPlan(plan);
  runtime.approve();
  runtime.completeInvestigation([]);
  return runtime;
}

const revision = { head: "a".repeat(40), workingTree: [["src/a.ts", "M hash"]] as Array<[string, string]> };

function juryResult(
  verdict: "APPROVE" | "REQUEST_CHANGES",
): WorkflowRunResult {
  const blockers = verdict === "REQUEST_CHANGES"
    ? [{
        evidence: "The stale branch remains reachable",
        path: "src/a.ts",
        requiredCorrection: "Remove the stale branch",
      }]
    : [];
  return {
    state: "completed",
    reasons: [],
    results: [{
      node: {
        id: "oracle",
        agent: "oracle",
        task: "review",
        dependsOn: [],
        required: true,
      },
      outcome: {
        state: "accepted",
        envelope: {
          requestId: `request-${verdict}`,
          ownerRunId: "owner",
          nodeId: "oracle",
          runId: `run-${verdict}`,
          status: "completed",
          launchContractDigest: "b".repeat(64),
          execution: { status: "completed", success: true, exitCode: 0 },
          acceptance: { status: "accepted", evidenceStatus: "verified", explicit: true },
          review: { status: "reviewed" },
          effects: {},
          artifacts: [],
          result: { kind: "structured", value: { verdict, warnings: [], blockers } },
          warnings: [],
          residualRisks: [],
        },
      },
    }],
  };
}

function passedVerification(): VerificationResult[] {
  return [{
    criterion: {
      id: "done",
      statement: "Done",
      evidenceRequired: ["diff", "test"],
    },
    passed: true,
    evidence: ["diff", "test"],
    missingEvidence: [],
  }];
}

describe("handleWorkflowAgentEnd", () => {
  it("continues one parent integration turn when no yield was claimed", async () => {
    const runtime = integrating();
    const sendContinuation = vi.fn(async () => {});
    const result = await handleWorkflowAgentEnd({
      runtime,
      cwd: "/repo",
      sendContinuation,
      runJury: vi.fn(),
      captureRevision: vi.fn(),
      recordWorkflowEvidence: vi.fn(),
      verify: vi.fn(() => []),
    }, { aborted: false, willRetry: false });

    expect(result).toEqual({ owned: true, state: "continued" });
    expect(runtime.current).toMatchObject({ phase: "integrating", integrationTurns: 1 });
    expect(sendContinuation).toHaveBeenCalledTimes(1);
    expect(sendContinuation).toHaveBeenCalledWith(expect.stringContaining("1/3"));
  });

  it("pauses on user abort without consuming an integration turn", async () => {
    const runtime = integrating();
    const sendContinuation = vi.fn(async () => {});

    const result = await handleWorkflowAgentEnd({
      runtime,
      cwd: "/repo",
      sendContinuation,
      runJury: vi.fn(),
      captureRevision: vi.fn(),
      recordWorkflowEvidence: vi.fn(),
      verify: vi.fn(() => []),
    }, { aborted: true, willRetry: false });

    expect(result).toEqual({ owned: true, state: "paused" });
    expect(runtime.current).toMatchObject({
      phase: "paused",
      reason: "user_abort",
      resume: { phase: "integrating", integrationTurns: 0 },
    });
    expect(sendContinuation).not.toHaveBeenCalled();
  });

  it("stands down for a Pi retry without consuming workflow budgets", async () => {
    const runtime = integrating();

    const result = await handleWorkflowAgentEnd({
      runtime,
      cwd: "/repo",
      sendContinuation: vi.fn(),
      runJury: vi.fn(),
      captureRevision: vi.fn(),
      recordWorkflowEvidence: vi.fn(),
      verify: vi.fn(() => []),
    }, { aborted: false, willRetry: true });

    expect(result).toEqual({ owned: true, state: "retrying" });
    expect(runtime.current).toMatchObject({
      phase: "integrating",
      integrationTurns: 0,
      juryRounds: 0,
    });
  });

  it("pauses a terminal parent failure without consuming workflow budgets", async () => {
    const runtime = integrating();

    const result = await handleWorkflowAgentEnd({
      runtime,
      cwd: "/repo",
      sendContinuation: vi.fn(),
      runJury: vi.fn(),
      captureRevision: vi.fn(),
      recordWorkflowEvidence: vi.fn(),
      verify: vi.fn(() => []),
    }, { aborted: false, willRetry: false, terminalFailure: true });

    expect(result).toEqual({ owned: true, state: "paused" });
    expect(runtime.current).toMatchObject({
      phase: "paused",
      reason: "parent_turn_failed",
      resume: { phase: "integrating", integrationTurns: 0 },
    });
  });

  it("pauses a yielded workflow when its repository revision is stale", async () => {
    const runtime = integrating();
    runtime.yieldForReview(revision);
    const runJury = vi.fn();

    const result = await handleWorkflowAgentEnd({
      runtime,
      cwd: "/repo",
      sendContinuation: vi.fn(),
      runJury,
      captureRevision: vi.fn(async () => ({ ...revision, head: "c".repeat(40) })),
      recordWorkflowEvidence: vi.fn(),
      verify: vi.fn(() => []),
    }, { aborted: false, willRetry: false });

    expect(result).toEqual({ owned: true, state: "paused" });
    expect(runtime.current).toMatchObject({
      phase: "paused",
      reason: "yield_revision_stale",
      resume: { phase: "reviewing", integrationTurns: 1 },
    });
    expect(runJury).not.toHaveBeenCalled();
  });

  it("returns structured jury blockers to the same Integration Owner", async () => {
    const runtime = integrating();
    runtime.yieldForReview(revision);
    const sendContinuation = vi.fn(async () => {});

    const result = await handleWorkflowAgentEnd({
      runtime,
      cwd: "/repo",
      sendContinuation,
      runJury: vi.fn(async () => juryResult("REQUEST_CHANGES")),
      captureRevision: vi.fn(async () => revision),
      recordWorkflowEvidence: vi.fn(),
      verify: vi.fn(() => []),
    }, { aborted: false, willRetry: false });

    expect(result).toEqual({ owned: true, state: "continued" });
    expect(runtime.current).toMatchObject({
      phase: "integrating",
      integrationTurns: 1,
      juryRounds: 1,
    });
    expect(sendContinuation).toHaveBeenCalledWith(expect.stringContaining("src/a.ts"));
    expect(sendContinuation).toHaveBeenCalledWith(expect.stringContaining("Remove the stale branch"));
  });

  it("completes standalone Waves only after jury approval and SpecEngine acceptance", async () => {
    const runtime = integrating();
    runtime.yieldForReview(revision);
    const recordWorkflowEvidence = vi.fn();

    const result = await handleWorkflowAgentEnd({
      runtime,
      cwd: "/repo",
      sendContinuation: vi.fn(),
      runJury: vi.fn(async () => juryResult("APPROVE")),
      captureRevision: vi.fn(async () => revision),
      recordWorkflowEvidence,
      verify: vi.fn(passedVerification),
    }, { aborted: false, willRetry: false });

    expect(result).toEqual({ owned: true, state: "completed" });
    expect(runtime.current).toMatchObject({
      phase: "completed",
      previous: { phase: "awaiting_acceptance", integrationTurns: 1, juryRounds: 1 },
    });
    expect(recordWorkflowEvidence).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ nodeId: "oracle" })]),
      { accepted: true, reasons: [] },
    );
  });

  it("holds Goal-Attached jury approval for the separate goal_complete claim", async () => {
    const runtime = integrating("goal_attached");
    runtime.yieldForReview(revision);
    const sendContinuation = vi.fn();

    const result = await handleWorkflowAgentEnd({
      runtime,
      cwd: "/repo",
      sendContinuation,
      runJury: vi.fn(async () => juryResult("APPROVE")),
      captureRevision: vi.fn(async () => revision),
      recordWorkflowEvidence: vi.fn(),
      verify: vi.fn(passedVerification),
    }, { aborted: false, willRetry: false });

    expect(result).toMatchObject({
      owned: true,
      state: "awaiting_goal_claim",
      directive: expect.stringContaining("goal_complete"),
    });
    expect(runtime.current).toMatchObject({ phase: "awaiting_acceptance", mode: "goal_attached" });
    expect(sendContinuation).not.toHaveBeenCalled();
  });

  it("counts omitted goal_complete turns and pauses at the shared integration ceiling", async () => {
    const runtime = integrating("goal_attached");
    runtime.yieldForReview(revision);
    const dependencies = {
      runtime,
      cwd: "/repo",
      sendContinuation: vi.fn(),
      runJury: vi.fn(async () => juryResult("APPROVE")),
      captureRevision: vi.fn(async () => revision),
      recordWorkflowEvidence: vi.fn(),
      verify: vi.fn(passedVerification),
    };
    await handleWorkflowAgentEnd(dependencies, { aborted: false, willRetry: false });

    expect(await handleWorkflowAgentEnd(
      dependencies,
      { aborted: false, willRetry: false, goalClaimed: false },
    )).toMatchObject({ owned: true, state: "awaiting_goal_claim" });
    expect(runtime.current).toMatchObject({ phase: "awaiting_acceptance", integrationTurns: 2 });

    expect(await handleWorkflowAgentEnd(
      dependencies,
      { aborted: false, willRetry: false, goalClaimed: false },
    )).toEqual({ owned: true, state: "paused" });
    expect(runtime.current).toMatchObject({
      phase: "paused",
      reason: "integration_turn_budget_exhausted",
      resume: { phase: "awaiting_acceptance", integrationTurns: 3 },
    });
  });

  it("rejects a goal_complete claim if the approved yield revision became stale", async () => {
    const runtime = integrating("goal_attached");
    runtime.yieldForReview(revision);
    const dependencies = {
      runtime,
      cwd: "/repo",
      sendContinuation: vi.fn(),
      runJury: vi.fn(async () => juryResult("APPROVE")),
      captureRevision: vi.fn(async () => revision),
      recordWorkflowEvidence: vi.fn(),
      verify: vi.fn(passedVerification),
    };
    await handleWorkflowAgentEnd(dependencies, { aborted: false, willRetry: false });
    dependencies.captureRevision.mockResolvedValue({ ...revision, head: "d".repeat(40) });

    expect(await handleWorkflowAgentEnd(
      dependencies,
      { aborted: false, willRetry: false, goalClaimed: true },
    )).toEqual({ owned: true, state: "paused" });
    expect(runtime.current).toMatchObject({
      phase: "paused",
      reason: "yield_revision_stale",
      resume: { phase: "awaiting_acceptance" },
    });
  });
});
