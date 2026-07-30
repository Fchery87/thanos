import { createHash } from "node:crypto";
import type { TaskContract } from "./task-contract";
import type { FormalSpec } from "./types";

export function targetRoots(contract: TaskContract): string[] {
  return [...new Set(contract.criteria.flatMap((criterion) => criterion.targets))].sort();
}

export function contractRevision(spec: FormalSpec): string {
  const identity = {
    tier: spec.tier,
    objective: spec.taskContract.objective,
    criteria: spec.taskContract.criteria,
    allowedCapabilities: [...spec.allowedCapabilities].sort(),
    targetFiles: [...spec.targetFiles].sort(),
    constraints: [...spec.constraints],
    risks: [...spec.risks],
    workflowPlan: spec.workflowPlan,
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
