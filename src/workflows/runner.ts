import type { DelegationOutcome } from "../delegation/runtime";
import { readyNodes, validateWorkflowPlan } from "./plan";
import type { WorkflowNode, WorkflowNodeResult, WorkflowPlan, WorkflowRunResult } from "./types";

export type DelegateWorkflowNode = (
  node: WorkflowNode,
  prior: ReadonlyMap<string, WorkflowNodeResult>,
) => Promise<DelegationOutcome>;

export class WorkflowRunner {
  constructor(private readonly delegate: DelegateWorkflowNode) {}

  async run(
    plan: WorkflowPlan,
    options: { completedNodeIds?: ReadonlySet<string> } = {},
  ): Promise<WorkflowRunResult> {
    const invalid = validateWorkflowPlan(plan);
    if (invalid.length > 0) return { state: "invalid_plan", results: [], reasons: invalid };

    const nodeIds = new Set(plan.nodes.map((node) => node.id));
    const restored = [...options.completedNodeIds ?? []];
    if (restored.some((nodeId) => !nodeIds.has(nodeId))) {
      return { state: "invalid_plan", results: [], reasons: ["completed node is not present in the workflow plan"] };
    }
    const completed = new Set(restored);
    const started = new Set(restored);
    const results = new Map<string, WorkflowNodeResult>();

    while (completed.size < plan.nodes.length) {
      const ready = readyNodes(plan.nodes, completed, started);
      if (ready.length === 0) {
        return { state: "invalid_plan", results: [...results.values()], reasons: ["workflow made no progress"] };
      }

      const batch = ready.slice(0, plan.maxConcurrency);
      batch.forEach((node) => started.add(node.id));
      const settled = await Promise.all(batch.map(async (node) => ({
        node,
        outcome: await this.delegate(node, results),
      })));
      for (const result of settled) {
        results.set(result.node.id, result);
        completed.add(result.node.id);
      }

      const failedRequired = settled.filter(({ node, outcome }) => node.required && outcome.state !== "accepted");
      if (failedRequired.length > 0) {
        return {
          state: "awaiting_evidence",
          results: [...results.values()],
          reasons: failedRequired.map(({ node, outcome }) =>
            outcome.state === "awaiting_evidence"
              ? `${node.id}: ${outcome.reasons.join("; ")}`
              : outcome.state === "failed"
                ? `${node.id}: ${outcome.reason}`
                : `${node.id}: required node was not accepted`,
          ),
        };
      }
    }

    return { state: "completed", results: [...results.values()], reasons: [] };
  }
}
