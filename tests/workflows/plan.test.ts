import { describe, expect, it } from "vitest";
import { validateWorkflowPlan } from "../../src/workflows/plan";
import type { WorkflowPlan } from "../../src/workflows/types";

function plan(nodes: WorkflowPlan["nodes"]): WorkflowPlan {
  return { id: "review", goal: "review changes", maxConcurrency: 3, nodes };
}

const readNode = (id: string, dependsOn: string[] = []) => ({
  id,
  agent: "reviewer",
  task: "review",
  dependsOn,
  required: true,
});

describe("validateWorkflowPlan", () => {
  it("accepts a bounded DAG", () => {
    expect(validateWorkflowPlan(plan([
      readNode("correctness"),
      readNode("security"),
      readNode("oracle", ["correctness", "security"]),
    ]))).toEqual([]);
  });

  it("rejects cycles and missing dependencies", () => {
    const errors = validateWorkflowPlan(plan([
      readNode("a", ["b"]),
      readNode("b", ["a"]),
      readNode("c", ["missing"]),
    ]));
    expect(errors).toContain("workflow graph contains a cycle");
    expect(errors).toContain("node c depends on missing node missing");
  });

  it("enforces the graph concurrency ceiling", () => {
    expect(validateWorkflowPlan({ ...plan([readNode("a")]), maxConcurrency: 5 }))
      .toContain("maxConcurrency must be between 1 and 4");
  });
});
