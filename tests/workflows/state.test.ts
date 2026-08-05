import { describe, expect, it } from "vitest";
import {
  WorkflowRuntime,
  WORKFLOW_JOURNAL_ENTRY,
  workflowAllowsGoalCompletion,
} from "../../src/workflows/state";
import type { WavePlan } from "../../src/workflows/types";

const plan: WavePlan = {
  id: "wave",
  goal: "implement",
  maxConcurrency: 1,
  integration: {
    targetRoots: ["src"],
    capabilities: ["read", "edit", "exec"],
    criteria: [{
      id: "implementation",
      statement: "The requested behavior is implemented and verified",
      evidenceRequired: ["diff", "test"],
    }],
    limits: { maxIntegrationTurns: 12, maxJuryRounds: 3 },
  },
  nodes: [{
    id: "inspect",
    agent: "explore",
    task: "inspect",
    dependsOn: [],
    required: true,
  }],
};

function withLimits(maxIntegrationTurns: number, maxJuryRounds: number): WavePlan {
  return {
    ...plan,
    integration: {
      ...plan.integration,
      limits: { maxIntegrationTurns, maxJuryRounds },
    },
  };
}

function integrating(runtime: WorkflowRuntime, workflowPlan: WavePlan = plan): void {
  runtime.start({ goal: "implement", mode: "standalone" });
  runtime.bindPlan(workflowPlan);
  runtime.approve();
  runtime.completeInvestigation([]);
}

describe("WorkflowRuntime journaled state", () => {
  it("reconstructs the latest valid state from the active session branch", () => {
    const entries: unknown[] = [];
    const runtime = new WorkflowRuntime({
      append: (snapshot) => entries.push({
        type: "custom",
        customType: WORKFLOW_JOURNAL_ENTRY,
        data: snapshot,
      }),
      createId: () => "workflow-1",
      now: () => 42,
    });

    expect(runtime.start({ goal: "implement", mode: "standalone" })).toMatchObject({
      phase: "planning",
      workflowId: "workflow-1",
    });
    expect(runtime.bindPlan(plan)).toMatchObject({ phase: "awaiting_approval", plan });

    const restored = new WorkflowRuntime().reconstruct([
      { type: "custom", customType: WORKFLOW_JOURNAL_ENTRY, data: { phase: "forged" } },
      ...entries,
    ]);
    expect(restored).toMatchObject({
      phase: "awaiting_approval",
      workflowId: "workflow-1",
      plan,
    });
  });

  it("does not publish lifecycle observations after a failed journal append", () => {
    const lifecycle: unknown[] = [];
    const runtime = new WorkflowRuntime({
      append: () => { throw new Error("journal unavailable"); },
      recordLifecycle: (event) => lifecycle.push(event),
    });
    expect(() => runtime.start({ goal: "implement", mode: "standalone" })).toThrow("journal unavailable");
    expect(runtime.current).toBeUndefined();
    expect(lifecycle).toEqual([]);
  });

  it("reports bounded lifecycle transitions without treating counter updates as new phases", () => {
    const lifecycle: Array<{ from?: string; to: string; workflowId: string; reason?: string }> = [];
    const runtime = new WorkflowRuntime({
      createId: () => "workflow-1",
      now: () => 42,
      recordLifecycle: (event) => lifecycle.push(event),
    });
    integrating(runtime);
    runtime.recordIntegrationTurn();
    runtime.pause("operator_paused");

    expect(lifecycle.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: undefined, to: "planning" },
      { from: "planning", to: "awaiting_approval" },
      { from: "awaiting_approval", to: "investigating" },
      { from: "investigating", to: "integrating" },
      { from: "integrating", to: "paused" },
    ]);
    expect(lifecycle.at(-1)).toMatchObject({ reason: "operator_paused", workflowId: "workflow-1" });
  });

  it("pauses and resumes the exact prior phase without resetting budgets", () => {
    const runtime = new WorkflowRuntime({
      createId: () => "workflow-1",
      now: () => 42,
    });
    runtime.start({ goal: "implement", mode: "standalone" });
    runtime.bindPlan(plan);
    runtime.approve();
    runtime.completeInvestigation([]);
    runtime.recordIntegrationTurn();

    expect(runtime.pause("user_abort")).toMatchObject({
      phase: "paused",
      reason: "user_abort",
      resume: { phase: "integrating", integrationTurns: 1, juryRounds: 0 },
    });
    expect(runtime.resume()).toMatchObject({
      phase: "integrating",
      integrationTurns: 1,
      juryRounds: 0,
    });
  });

  it("restores an active branch paused and journals the lost-authority reason", () => {
    const entries: unknown[] = [];
    const source = new WorkflowRuntime({
      append: (snapshot) => entries.push({
        type: "custom",
        customType: WORKFLOW_JOURNAL_ENTRY,
        data: snapshot,
      }),
      createId: () => "workflow-1",
      now: () => 42,
    });
    source.start({ goal: "implement", mode: "standalone" });
    source.bindPlan(plan);
    source.approve();

    const appended: unknown[] = [];
    const restored = new WorkflowRuntime({ append: (snapshot) => appended.push(snapshot) })
      .reconstruct(entries, { pauseActiveReason: "restart_requires_approval" });

    expect(restored).toMatchObject({
      phase: "paused",
      reason: "restart_requires_approval",
      resume: { phase: "investigating" },
    });
    expect(appended).toEqual([restored]);
  });

  it("journals accepted investigation siblings and fresh attempt counts before a pause", () => {
    const runtime = new WorkflowRuntime({ createId: () => "progress", now: () => 42 });
    runtime.start({ goal: "implement", mode: "standalone" });
    runtime.bindPlan(plan);
    runtime.approve();
    const evidence = [{
      nodeId: "inspect",
      requestId: "request-1",
      ownerRunId: "owner",
      runId: "run-1",
      launchContractDigest: "a".repeat(64),
      artifacts: [],
    }];

    expect(runtime.recordInvestigationProgress(evidence, ["inspect"])).toMatchObject({
      phase: "investigating",
      acceptedEvidence: evidence,
      nodeAttempts: { inspect: 1 },
    });
    runtime.pause("required_node_failed");
    runtime.resume();
    expect(runtime.recordInvestigationProgress([], ["inspect"])).toMatchObject({
      nodeAttempts: { inspect: 2 },
      acceptedEvidence: evidence,
    });
  });

  it("makes cancellation terminal while handoff creates a new paused identity", () => {
    const cancelled = new WorkflowRuntime({
      createId: () => "cancelled-source",
      now: () => 42,
    });
    cancelled.start({ goal: "implement", mode: "standalone" });
    cancelled.bindPlan(plan);
    expect(cancelled.cancel("operator_cancelled")).toMatchObject({
      phase: "cancelled",
      workflowId: "cancelled-source",
      reason: "operator_cancelled",
    });
    expect(() => cancelled.resume()).toThrow(/paused/);

    const source = new WorkflowRuntime({
      createId: () => "handoff-source",
      now: () => 42,
    });
    source.start({ goal: "implement", mode: "standalone" });
    source.bindPlan(plan);
    source.approve();
    source.completeInvestigation([]);
    source.recordIntegrationTurn();

    const handoff = source.handoff("handoff-destination");
    expect(handoff.source).toMatchObject({
      phase: "handed_off",
      destinationWorkflowId: "handoff-destination",
    });
    expect(handoff.destination).toMatchObject({
      phase: "paused",
      workflowId: "handoff-destination",
      lineageParentId: "handoff-source",
      reason: "handoff_requires_approval",
      resume: {
        phase: "integrating",
        integrationTurns: 1,
        juryRounds: 0,
      },
    });
    expect(source.restoreFailedHandoff("session_replacement_cancelled")).toMatchObject({
      phase: "paused",
      reason: "session_replacement_cancelled",
      resume: { phase: "integrating", integrationTurns: 1 },
    });
  });

  it("enforces total integration-turn and jury-round ceilings without resetting them", () => {
    const turnLimited = new WorkflowRuntime({ createId: () => "turns", now: () => 42 });
    integrating(turnLimited, withLimits(2, 3));
    expect(turnLimited.recordIntegrationTurn()).toMatchObject({ phase: "integrating", integrationTurns: 1 });
    expect(turnLimited.recordIntegrationTurn()).toMatchObject({
      phase: "paused",
      reason: "integration_turn_budget_exhausted",
      resume: { integrationTurns: 2 },
    });

    const juryLimited = new WorkflowRuntime({ createId: () => "jury", now: () => 42 });
    integrating(juryLimited, withLimits(12, 2));
    const revision = { head: "a".repeat(40), workingTree: [["src/a.ts", "M hash"]] as Array<[string, string]> };
    expect(juryLimited.yieldForReview(revision)).toMatchObject({ phase: "reviewing", juryRounds: 1 });
    expect(juryLimited.requestChanges("fix one")).toMatchObject({ phase: "integrating", juryRounds: 1 });
    expect(juryLimited.yieldForReview(revision)).toMatchObject({ phase: "reviewing", juryRounds: 2 });
    expect(juryLimited.requestChanges("fix two")).toMatchObject({
      phase: "paused",
      reason: "jury_round_budget_exhausted",
      resume: { phase: "integrating", juryRounds: 2 },
    });
  });

  it("revises only an exhausted budget upward and preserves consumed totals", () => {
    const runtime = new WorkflowRuntime({ createId: () => "budget", now: () => 42 });
    integrating(runtime, withLimits(2, 2));
    runtime.recordIntegrationTurn();
    runtime.recordIntegrationTurn();

    expect(runtime.reviseLimits({ maxIntegrationTurns: 4 })).toMatchObject({
      phase: "paused",
      reason: "contract_revision_requires_approval",
      resume: {
        phase: "integrating",
        integrationTurns: 2,
        juryRounds: 0,
        plan: { integration: { limits: { maxIntegrationTurns: 4, maxJuryRounds: 2 } } },
      },
    });
    expect(() => runtime.reviseLimits({ maxIntegrationTurns: 3 })).toThrow(/only exhausted budgets/i);
  });

  it("keeps jury approval nonterminal until SpecEngine acceptance", () => {
    const runtime = new WorkflowRuntime({ createId: () => "acceptance", now: () => 42 });
    integrating(runtime);
    const revision = { head: "a".repeat(40), workingTree: [] };
    runtime.yieldForReview(revision);
    expect(runtime.approveReview([])).toMatchObject({
      phase: "awaiting_acceptance",
      yieldIdentity: revision,
    });
    expect(runtime.complete("SpecEngine accepted the Work Contract")).toMatchObject({
      phase: "completed",
      reason: "SpecEngine accepted the Work Contract",
      previous: { phase: "awaiting_acceptance" },
    });
  });

  it("allows Goal completion only at Goal-Attached awaiting acceptance", () => {
    const runtime = new WorkflowRuntime({ createId: () => "goal", now: () => 42 });
    runtime.start({ goal: "implement", mode: "goal_attached" });
    runtime.bindPlan(plan);
    runtime.approve();
    runtime.completeInvestigation([]);
    expect(workflowAllowsGoalCompletion(runtime.current)).toBe(false);
    const revision = { head: "a".repeat(40), workingTree: [] };
    runtime.yieldForReview(revision);
    runtime.approveReview([]);
    expect(workflowAllowsGoalCompletion(runtime.current)).toBe(true);
    runtime.pause("yield_revision_stale");
    expect(workflowAllowsGoalCompletion(runtime.current)).toBe(false);
  });
});
