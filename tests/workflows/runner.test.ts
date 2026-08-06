import { describe, expect, it, vi } from "vitest";
import { WorkflowRunner } from "../../src/workflows/runner";
import type { WorkflowPlan } from "../../src/workflows/types";

const accepted = {
  state: "accepted" as const,
  envelope: {
    requestId: "request",
    ownerRunId: "owner",
    nodeId: "node",
    runId: "run",
    status: "completed",
    launchContractDigest: "a".repeat(64),
    execution: { status: "completed" as const, success: true, exitCode: 0 },
    acceptance: { status: "accepted" as const, evidenceStatus: "verified" as const, explicit: true },
    review: { status: "reviewed" as const },
    effects: {},
    artifacts: [],
    warnings: [],
    residualRisks: [],
  },
};

function jury(): WorkflowPlan {
  const node = (id: string, dependsOn: string[] = []) => ({
    id,
    agent: "reviewer",
    task: id,
    dependsOn,
    required: true,
  });
  return {
    id: "jury",
    goal: "review",
    maxConcurrency: 3,
    nodes: [
      node("correctness"),
      node("security"),
      node("tests"),
      node("oracle", ["correctness", "security", "tests"]),
    ],
  };
}

describe("WorkflowRunner", () => {
  it("runs independent critics before their dependent oracle", async () => {
    const order: string[][] = [];
    let active: string[] = [];
    const runner = new WorkflowRunner(async (node) => {
      active.push(node.id);
      await Promise.resolve();
      if (active.length === 3 || node.id === "oracle") {
        order.push([...active].sort());
        active = [];
      }
      return accepted;
    });
    expect((await runner.run(jury())).state).toBe("completed");
    expect(order).toEqual([["correctness", "security", "tests"], ["oracle"]]);
  });

  it("normalizes rejected delegates and preserves accepted siblings", async () => {
    const plan: WorkflowPlan = {
      id: "parallel",
      goal: "review",
      maxConcurrency: 2,
      nodes: [
        { id: "accepted", agent: "reviewer", task: "accepted", dependsOn: [], required: true },
        { id: "rejected", agent: "reviewer", task: "rejected", dependsOn: [], required: false },
      ],
    };
    const result = await new WorkflowRunner(async (node) => {
      if (node.id === "rejected") throw new Error("child promise rejected");
      return accepted;
    }).run(plan);

    expect(result.state).toBe("completed");
    expect(result.results).toHaveLength(2);
    expect(result.results.find(({ node }) => node.id === "accepted")?.outcome.state).toBe("accepted");
    expect(result.results.find(({ node }) => node.id === "rejected")?.outcome).toEqual({
      state: "failed",
      reason: "child promise rejected",
    });
  });

  it("preserves a successful outcome when the observer throws", async () => {
    const onSettled = vi.fn(() => { throw new Error("observer unavailable"); });
    const result = await new WorkflowRunner(async () => accepted, { onSettled }).run({
      id: "single",
      goal: "review",
      maxConcurrency: 1,
      nodes: [{ id: "critic", agent: "reviewer", task: "critic", dependsOn: [], required: true }],
    });
    expect(result.state).toBe("completed");
    expect(result.results[0].outcome.state).toBe("accepted");
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
  it("does not run dependents after a required delegate rejects", async () => {
    const delegate = vi.fn(async (node: { id: string }) => {
      if (node.id === "security") throw new Error("security worker crashed");
      return accepted;
    });
    const result = await new WorkflowRunner(delegate).run(jury());

    expect(result.state).toBe("awaiting_evidence");
    expect(result.reasons.join(" ")).toContain("security");
    expect(delegate).toHaveBeenCalledTimes(3);
    expect(delegate).not.toHaveBeenCalledWith(expect.objectContaining({ id: "oracle" }), expect.anything());
  });
  it("stops required downstream work when evidence is incomplete", async () => {
    const delegate = vi.fn(async (node: { id: string }) =>
      node.id === "security"
        ? { state: "awaiting_evidence" as const, reasons: ["review evidence is missing"] }
        : accepted,
    );
    const result = await new WorkflowRunner(delegate).run(jury());
    expect(result.state).toBe("awaiting_evidence");
    expect(delegate).toHaveBeenCalledTimes(3);
    expect(result.reasons[0]).toContain("security");
  });


  it("preserves completed siblings and resumes only unsettled nodes", async () => {
    const delegate = vi.fn(async () => accepted);
    const result = await new WorkflowRunner(delegate).run(jury(), {
      completedNodeIds: new Set(["correctness", "security", "tests"]),
    });

    expect(result.state).toBe("completed");
    expect(delegate).toHaveBeenCalledTimes(1);
    expect(delegate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "oracle" }),
      expect.any(Map),
    );
  });
});
