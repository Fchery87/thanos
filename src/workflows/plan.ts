import type { WorkflowNode, WorkflowPlan } from "./types";

const MAX_NODES = 8;
const MAX_CONCURRENCY = 4;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;

export function validateWorkflowPlan(plan: WorkflowPlan): string[] {
  const errors: string[] = [];
  if (!ID.test(plan.id)) errors.push("workflow id is invalid");
  if (!plan.goal.trim()) errors.push("workflow goal is empty");
  if (!Number.isInteger(plan.maxConcurrency) || plan.maxConcurrency < 1 || plan.maxConcurrency > MAX_CONCURRENCY) {
    errors.push(`maxConcurrency must be between 1 and ${MAX_CONCURRENCY}`);
  }
  if (plan.nodes.length === 0 || plan.nodes.length > MAX_NODES) errors.push(`workflow must contain 1-${MAX_NODES} nodes`);

  const ids = new Set<string>();
  for (const node of plan.nodes) {
    if (!ID.test(node.id)) errors.push(`node id is invalid: ${node.id}`);
    if (ids.has(node.id)) errors.push(`duplicate node id: ${node.id}`);
    ids.add(node.id);
    if (!node.agent.trim()) errors.push(`node ${node.id} has no agent`);
    if (!node.task.trim()) errors.push(`node ${node.id} has no task`);
  }
  for (const node of plan.nodes) {
    for (const dependency of node.dependsOn) {
      if (!ids.has(dependency)) errors.push(`node ${node.id} depends on missing node ${dependency}`);
      if (dependency === node.id) errors.push(`node ${node.id} depends on itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cyclic = (byId.get(id)?.dependsOn ?? []).some(visit);
    visiting.delete(id);
    visited.add(id);
    return cyclic;
  };
  if (plan.nodes.some((node) => visit(node.id))) errors.push("workflow graph contains a cycle");

  return [...new Set(errors)];
}

export function readyNodes(
  nodes: WorkflowNode[],
  completed: Set<string>,
  started: Set<string>,
): WorkflowNode[] {
  return nodes.filter((node) =>
    !started.has(node.id) && node.dependsOn.every((dependency) => completed.has(dependency)),
  );
}
