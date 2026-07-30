import { describe, expect, it, vi } from "vitest";
import { WorkflowRunner } from "../../src/workflows/runner";
import type { WorkflowPlan } from "../../src/workflows/types";

const accepted = {
  state: "accepted" as const,
  envelope: {
    version: 2 as const,
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
