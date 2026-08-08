import { describe, expect, it } from "vitest";
import { createWorkflowModule } from "../../src/workflows/module";
import { WORKFLOW_JOURNAL_ENTRY, WorkflowRuntime, type WorkflowSnapshot } from "../../src/workflows/state";
import type { WavePlan, WorkflowReceipt } from "../../src/workflows/types";

const plan: WavePlan = {
  id: "wave",
  goal: "implement",
  maxConcurrency: 1,
  integration: {
    targetRoots: ["src"],
    capabilities: ["read"],
    criteria: [{ id: "done", statement: "done", evidenceRequired: ["command"] }],
    limits: { maxIntegrationTurns: 2, maxJuryRounds: 1 },
  },
  nodes: [{ id: "inspect", agent: "explore", task: "inspect", dependsOn: [], required: true }],
};

function createModule(entries: unknown[] = []) {
  const runtime = new WorkflowRuntime({
    append: (snapshot) => entries.push({
      type: "custom",
      customType: WORKFLOW_JOURNAL_ENTRY,
      data: snapshot,
    }),
    createId: () => "workflow-1",
    now: () => 42,
  });
  const approve = async (): Promise<WorkflowReceipt> => {
    runtime.bindPlan(plan);
    return { state: "settled", command: "signal", snapshot: runtime.approve() };
  };
  const resume = async (signal: { maxIntegrationTurns?: number; maxJuryRounds?: number }): Promise<WorkflowReceipt> => {
    if (signal.maxIntegrationTurns !== undefined || signal.maxJuryRounds !== undefined) {
      runtime.reviseLimits(signal);
    }
    return { state: "settled", command: "signal", snapshot: runtime.resume() };
  };
  return {
    entries,
    runtime,
    workflow: createWorkflowModule({ runtime, handleApproval: approve, handleResume: resume }),
  };
}

describe("WorkflowModule", () => {
  it("owns representative lifecycle transitions through dispatch", async () => {
    const { workflow } = createModule();
    expect(await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } }))
      .toMatchObject({ state: "settled", snapshot: { phase: "planning", workflowId: "workflow-1" } });
    expect(await workflow.dispatch({ kind: "signal", signal: { id: "approval", kind: "approval", plan } }))
      .toMatchObject({ state: "settled", snapshot: { phase: "investigating" } });
    expect(await workflow.dispatch({ kind: "signal", signal: { kind: "pause", reason: "operator_paused" } }))
      .toMatchObject({ state: "settled", snapshot: { phase: "paused", reason: "operator_paused" } });
    expect(await workflow.dispatch({ kind: "signal", signal: { kind: "resume" } }))
      .toMatchObject({ state: "settled", snapshot: { phase: "investigating" } });
    expect(await workflow.dispatch({ kind: "signal", signal: { kind: "cancel", reason: "operator_cancelled" } }))
      .toMatchObject({ state: "settled", snapshot: { phase: "cancelled" } });
  });

  it("deduplicates a lifecycle delivery with an id", async () => {
    const { workflow } = createModule();
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    const command = { kind: "signal" as const, signal: { id: "approval", kind: "approval" as const, plan } };
    const first = await workflow.dispatch(command);
    const second = await workflow.dispatch(command);
    expect(second).toEqual(first);
    expect(second).toMatchObject({ state: "settled", snapshot: { phase: "investigating" } });
  });

  it("deduplicates concurrent lifecycle delivery with an id", async () => {
    const entries: unknown[] = [];
    const runtime = new WorkflowRuntime({ append: (snapshot) => entries.push(snapshot) });
    let releaseApproval: (() => void) | undefined;
    const workflow = createWorkflowModule({
      runtime,
      handleApproval: async () => {
        await new Promise<void>((resolve) => { releaseApproval = resolve; });
        runtime.bindPlan(plan);
        return { state: "settled", command: "signal", snapshot: runtime.approve() };
      },
    });
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    const command = { kind: "signal" as const, signal: { id: "approval", kind: "approval" as const, plan } };
    const first = workflow.dispatch(command);
    const second = workflow.dispatch(command);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!releaseApproval) throw new Error("approval adapter was not started");
    releaseApproval();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ state: "settled", snapshot: expect.objectContaining({ phase: "investigating" }) }),
      expect.objectContaining({ state: "settled", snapshot: expect.objectContaining({ phase: "investigating" }) }),
    ]);
    expect(entries.filter((snapshot) => (snapshot as { phase: string }).phase === "investigating")).toHaveLength(1);
  });

  it("scopes signal receipts to the workflow that received them", async () => {
    const runtime = new WorkflowRuntime({ createId: (() => {
      let count = 0;
      return () => `workflow-${++count}`;
    })() });
    let approvals = 0;
    const workflow = createWorkflowModule({
      runtime,
      handleApproval: async () => {
        approvals += 1;
        runtime.bindPlan(plan);
        return { state: "settled", command: "signal", snapshot: runtime.approve() };
      },
    });
    const approval = { kind: "signal" as const, signal: { id: "approval", kind: "approval" as const, plan } };
    await workflow.dispatch({ kind: "start", request: { goal: "first", mode: "standalone" } });
    await workflow.dispatch(approval);
    const cancel = workflow.dispatch({ kind: "signal", signal: { kind: "cancel", reason: "done" } });
    const second = workflow.dispatch({ kind: "start", request: { goal: "second", mode: "standalone" } });
    const repeatedApproval = workflow.dispatch(approval);
    await Promise.all([cancel, second]);
    await expect(repeatedApproval).resolves.toMatchObject({
      state: "settled",
      snapshot: { workflowId: "workflow-2", phase: "investigating" },
    });
    expect(approvals).toBe(2);
  });

  it("serializes an in-flight authority adapter before later lifecycle changes", async () => {
    const runtime = new WorkflowRuntime({ createId: (() => {
      let count = 0;
      return () => `workflow-${++count}`;
    })() });
    let releaseApproval: (() => void) | undefined;
    const workflow = createWorkflowModule({
      runtime,
      handleApproval: async () => {
        await new Promise<void>((resolve) => { releaseApproval = resolve; });
        runtime.bindPlan(plan);
        return { state: "settled", command: "signal", snapshot: runtime.approve() };
      },
    });
    await workflow.dispatch({ kind: "start", request: { goal: "first", mode: "standalone" } });
    const approval = workflow.dispatch({ kind: "signal", signal: { id: "approval:first", kind: "approval", plan } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const cancel = workflow.dispatch({ kind: "signal", signal: { kind: "cancel", reason: "cancel first" } });
    const second = workflow.dispatch({ kind: "start", request: { goal: "second", mode: "standalone" } });
    if (!releaseApproval) throw new Error("approval adapter was not started");
    releaseApproval();
    await Promise.all([approval, cancel, second]);
    expect(workflow.inspect()?.snapshot).toMatchObject({ workflowId: "workflow-2", phase: "planning", goal: "second" });
  });

  it("does not execute a command aborted while waiting in the lifecycle queue", async () => {
    const runtime = new WorkflowRuntime({ createId: () => "workflow-1" });
    let releaseApproval: (() => void) | undefined;
    const workflow = createWorkflowModule({
      runtime,
      handleApproval: async () => {
        await new Promise<void>((resolve) => { releaseApproval = resolve; });
        runtime.bindPlan(plan);
        return { state: "settled", command: "signal", snapshot: runtime.approve() };
      },
    });
    await workflow.dispatch({ kind: "start", request: { goal: "first", mode: "standalone" } });
    const approval = workflow.dispatch({ kind: "signal", signal: { kind: "approval", plan } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const controller = new AbortController();
    const cancelled = workflow.dispatch({ kind: "signal", signal: { kind: "cancel", reason: "stale" } }, controller.signal);
    controller.abort();
    if (!releaseApproval) throw new Error("approval adapter was not started");
    releaseApproval();
    await approval;
    await expect(cancelled).resolves.toMatchObject({ state: "rejected", reason: "workflow_command_aborted" });
    expect(workflow.inspect()?.snapshot).toMatchObject({ phase: "investigating" });
  });

  it("rejects every authority-owned signal without a construction adapter", async () => {
    const runtime = new WorkflowRuntime();
    const workflow = createWorkflowModule({ runtime });
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    for (const signal of [
      { kind: "approval" as const, plan },
      { kind: "parent_turn_ended" as const },
      { kind: "resume" as const },
      { kind: "handoff" as const },
      { kind: "goal_completion_claim" as const },
    ]) {
      await expect(workflow.dispatch({ kind: "signal", signal })).resolves.toMatchObject({
        state: "rejected",
        reason: `workflow_signal_unavailable:${signal.kind}`,
      });
    }
    expect(workflow.inspect()?.snapshot).toMatchObject({ phase: "planning" });
  });

  it("yields one revision through the facade and deduplicates its lifecycle signal", async () => {
    const entries: Array<{ type: "custom"; customType: typeof WORKFLOW_JOURNAL_ENTRY; data: WorkflowSnapshot }> = [];
    const runtime = new WorkflowRuntime({
      append: (snapshot) => entries.push({ type: "custom", customType: WORKFLOW_JOURNAL_ENTRY, data: snapshot }),
    });
    const workflow = createWorkflowModule({
      runtime,
      handleApproval: async () => {
        runtime.bindPlan(plan);
        runtime.approve();
        return { state: "settled", command: "signal", snapshot: runtime.completeInvestigation([]) };
      },
    });
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    await workflow.dispatch({ kind: "signal", signal: { kind: "approval", plan } });
    const revision = { head: "a".repeat(40), workingTree: [] as Array<[string, string]> };
    const command = { kind: "signal" as const, signal: { id: "yield:revision-a", kind: "yield" as const, yieldIdentity: revision } };
    const [first, duplicate] = await Promise.all([workflow.dispatch(command), workflow.dispatch(command)]);
    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({ state: "settled", snapshot: { phase: "reviewing", juryRounds: 1, yieldIdentity: revision } });
    expect(entries.filter((entry) => entry.data.phase === "reviewing")).toHaveLength(1);
  });

  it("retries a rejected yield delivery after journal recovery", async () => {
    let appendFails = false;
    const runtime = new WorkflowRuntime({
      append: () => {
        if (appendFails) throw new Error("journal unavailable");
      },
    });
    const workflow = createWorkflowModule({
      runtime,
      handleApproval: async () => {
        runtime.bindPlan(plan);
        runtime.approve();
        return { state: "settled", command: "signal", snapshot: runtime.completeInvestigation([]) };
      },
    });
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    await workflow.dispatch({ kind: "signal", signal: { kind: "approval", plan } });
    appendFails = true;
    const command = {
      kind: "signal" as const,
      signal: { id: "yield:recovered", kind: "yield" as const, yieldIdentity: { head: "c".repeat(40), workingTree: [] } },
    };
    await expect(workflow.dispatch(command)).resolves.toMatchObject({ state: "rejected", reason: "journal unavailable" });
    expect(workflow.inspect()?.snapshot.phase).toBe("integrating");
    appendFails = false;
    await expect(workflow.dispatch(command)).resolves.toMatchObject({ state: "settled", snapshot: { phase: "reviewing" } });
  });

  it("settles a yielded revision once through the parent-turn authority adapter", async () => {
    const runtime = new WorkflowRuntime({ createId: () => "workflow-1", now: () => 42 });
    let juryAttempts = 0;
    let specSettlements = 0;
    const workflow = createWorkflowModule({
      runtime,
      handleApproval: async () => {
        runtime.bindPlan(plan);
        runtime.approve();
        return { state: "settled", command: "signal", snapshot: runtime.completeInvestigation([]) };
      },
      handleParentTurnEnded: async () => {
        juryAttempts += 1;
        specSettlements += 1;
        return { state: "settled", command: "signal", snapshot: runtime.approveReview([]) };
      },
    });
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    await workflow.dispatch({ kind: "signal", signal: { kind: "approval", plan } });
    const revision = { head: "a".repeat(40), workingTree: [] as Array<[string, string]> };
    await workflow.dispatch({ kind: "signal", signal: { kind: "yield", yieldIdentity: revision } });
    const command = { kind: "signal" as const, signal: { id: "parent-turn:1", kind: "parent_turn_ended" as const } };
    const [first, duplicate] = await Promise.all([workflow.dispatch(command), workflow.dispatch(command)]);
    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({ state: "settled", snapshot: { phase: "awaiting_acceptance", yieldIdentity: revision } });
    expect({ juryAttempts, specSettlements }).toEqual({ juryAttempts: 1, specSettlements: 1 });
  });

  it("retains an opaque authority adapter rejection for duplicate delivery", async () => {
    const runtime = new WorkflowRuntime();
    let attempts = 0;
    const workflow = createWorkflowModule({
      runtime,
      handleParentTurnEnded: async () => {
        attempts += 1;
        return { state: "rejected", command: "signal", reason: "jury_transport_failed", snapshot: runtime.current };
      },
    });
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    const command = { kind: "signal" as const, signal: { id: "parent-turn:failed", kind: "parent_turn_ended" as const } };
    await expect(workflow.dispatch(command)).resolves.toMatchObject({ state: "rejected", reason: "jury_transport_failed" });
    await expect(workflow.dispatch(command)).resolves.toMatchObject({ state: "rejected", reason: "jury_transport_failed" });
    expect(attempts).toBe(1);
  });

  it("does not treat a goal completion claim as workflow completion", async () => {
    const runtime = new WorkflowRuntime({ createId: () => "goal-workflow", now: () => 42 });
    let claimChecks = 0;
    const workflow = createWorkflowModule({
      runtime,
      handleApproval: async () => {
        runtime.bindPlan(plan);
        runtime.approve();
        return { state: "settled", command: "signal", snapshot: runtime.completeInvestigation([]) };
      },
      handleParentTurnEnded: async () => ({
        state: "settled",
        command: "signal",
        snapshot: runtime.approveReview([]),
      }),
      handleGoalCompletionClaim: async () => {
        claimChecks += 1;
        return { state: "settled", command: "signal", snapshot: runtime.current };
      },
    });
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "goal_attached" } });
    await workflow.dispatch({ kind: "signal", signal: { kind: "approval", plan } });
    await workflow.dispatch({ kind: "signal", signal: { kind: "yield", yieldIdentity: { head: "b".repeat(40), workingTree: [] } } });
    await workflow.dispatch({ kind: "signal", signal: { kind: "parent_turn_ended" } });
    const command = { kind: "signal" as const, signal: { id: "goal-claim:1", kind: "goal_completion_claim" as const } };
    const [first, duplicate] = await Promise.all([workflow.dispatch(command), workflow.dispatch(command)]);
    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({ state: "settled", snapshot: { phase: "awaiting_acceptance", mode: "goal_attached" } });
    expect(claimChecks).toBe(1);
    expect(workflow.inspect()?.snapshot.phase).toBe("awaiting_acceptance");
  });

  it("routes a handoff through its construction-only authority adapter", async () => {
    const runtime = new WorkflowRuntime({ createId: () => "source", now: () => 42 });
    const destinationIds: string[] = [];
    const workflow = createWorkflowModule({
      runtime,
      handleHandoff: async (signal) => {
        const handoff = runtime.handoff(signal.destinationWorkflowId);
        destinationIds.push(handoff.destination.workflowId);
        return { state: "settled", command: "signal", snapshot: handoff.source };
      },
    });
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    await expect(workflow.dispatch({
      kind: "signal",
      signal: { kind: "handoff", destinationWorkflowId: "destination" },
    })).resolves.toMatchObject({
      state: "settled",
      snapshot: { phase: "handed_off", destinationWorkflowId: "destination" },
    });
    expect(destinationIds).toEqual(["destination"]);
  });

  it("rejects resume without the authority-owned approval adapter", async () => {
    const runtime = new WorkflowRuntime();
    const workflow = createWorkflowModule({ runtime });
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    await workflow.dispatch({ kind: "signal", signal: { kind: "pause", reason: "restore_requires_approval" } });
    await expect(workflow.dispatch({ kind: "signal", signal: { kind: "resume" } }))
      .resolves.toMatchObject({ state: "rejected", reason: "workflow_signal_unavailable:resume" });
  });

  it("restores an active journal entry paused for authority reacquisition", async () => {
    const source = createModule();
    await source.workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    await source.workflow.dispatch({ kind: "signal", signal: { kind: "approval", plan } });
    const restored = createModule();
    expect(await restored.workflow.dispatch({
      kind: "restore",
      entries: source.entries,
      pauseActiveReason: "restart_requires_approval",
    })).toMatchObject({
      state: "settled",
      snapshot: { phase: "paused", reason: "restart_requires_approval", resume: { phase: "investigating" } },
    });
  });

  it("restores a current-schema journal fixture through dispatch", async () => {
    const fixture = [{
      type: "custom",
      customType: WORKFLOW_JOURNAL_ENTRY,
      data: {
        phase: "awaiting_approval",
        workflowId: "fixture-workflow",
        goal: "implement",
        mode: "standalone",
        createdAt: 42,
        plan,
        acceptedEvidence: [],
        nodeAttempts: {},
        integrationTurns: 0,
        juryRounds: 0,
      },
    }];
    const { workflow } = createModule();
    await expect(workflow.dispatch({ kind: "restore", entries: fixture }))
      .resolves.toMatchObject({
        state: "settled",
        snapshot: {
          phase: "paused",
          reason: "restore_requires_approval",
          resume: { phase: "awaiting_approval", workflowId: "fixture-workflow" },
        },
      });
  });

  it("defaults restores to a paused authority-reacquisition state", async () => {
    const source = createModule();
    await source.workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    await source.workflow.dispatch({ kind: "signal", signal: { kind: "approval", plan } });
    const restored = createModule();
    await expect(restored.workflow.dispatch({ kind: "restore", entries: source.entries }))
      .resolves.toMatchObject({ state: "settled", snapshot: { phase: "paused", reason: "restore_requires_approval" } });
  });

  it("returns a copied observation rather than mutable runtime state", async () => {
    const { workflow } = createModule();
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    const observed = workflow.inspect();
    if (!observed) throw new Error("expected workflow view");
    observed.snapshot.goal = "forged";
    expect(workflow.inspect()?.snapshot.goal).toBe("implement");
  });

  it("does not expose direct state or acceptance mutations", () => {
    const { workflow } = createModule();
    expect(Object.keys(workflow).sort()).toEqual(["dispatch", "inspect"]);
    expect(workflow.inspect()).toBeUndefined();
  });

  it("rejects whitespace-only workflow goals before they enter the journal", async () => {
    const { workflow } = createModule();
    await expect(workflow.dispatch({ kind: "start", request: { goal: "   ", mode: "standalone" } }))
      .resolves.toMatchObject({ state: "rejected", reason: "A Waves workflow requires a nonempty goal" });
    expect(workflow.inspect()).toBeUndefined();
  });

  it("does not publish a state change when journaling fails", async () => {
    const runtime = new WorkflowRuntime({ append: () => { throw new Error("journal unavailable"); } });
    const workflow = createWorkflowModule({ runtime });
    await expect(workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } }))
      .resolves.toMatchObject({ state: "rejected", reason: "journal unavailable" });
    expect(workflow.inspect()).toBeUndefined();
  });

  it("fails closed when it cannot journal an authority-reacquisition pause", async () => {
    const source = createModule();
    await source.workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    await source.workflow.dispatch({ kind: "signal", signal: { kind: "approval", plan } });
    const runtime = new WorkflowRuntime({ append: () => { throw new Error("journal unavailable"); } });
    const workflow = createWorkflowModule({ runtime });
    await expect(workflow.dispatch({
      kind: "restore",
      entries: source.entries,
      pauseActiveReason: "restart_requires_approval",
    })).resolves.toMatchObject({ state: "rejected", reason: "journal unavailable" });
    expect(workflow.inspect()).toBeUndefined();
  });
});
