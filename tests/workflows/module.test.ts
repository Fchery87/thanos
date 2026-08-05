import { describe, expect, it } from "vitest";
import { createWorkflowModule } from "../../src/workflows/module";
import { WORKFLOW_JOURNAL_ENTRY, WorkflowRuntime } from "../../src/workflows/state";
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
    if (!releaseApproval) throw new Error("approval adapter was not started");
    releaseApproval();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ state: "settled", snapshot: expect.objectContaining({ phase: "investigating" }) }),
      expect.objectContaining({ state: "settled", snapshot: expect.objectContaining({ phase: "investigating" }) }),
    ]);
    expect(entries.filter((snapshot) => (snapshot as { phase: string }).phase === "investigating")).toHaveLength(1);
  });

  it("rejects authority-owned signals without a construction adapter", async () => {
    const runtime = new WorkflowRuntime();
    const workflow = createWorkflowModule({ runtime });
    await workflow.dispatch({ kind: "start", request: { goal: "implement", mode: "standalone" } });
    await expect(workflow.dispatch({ kind: "signal", signal: { kind: "approval", plan } }))
      .resolves.toMatchObject({ state: "rejected", reason: "workflow_signal_unavailable:approval" });
    await expect(workflow.dispatch({ kind: "signal", signal: { kind: "parent_turn_ended" } }))
      .resolves.toMatchObject({ state: "rejected", reason: "workflow_signal_unavailable:parent_turn_ended" });
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
