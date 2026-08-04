import type { GoalSnapshot } from "../goal/types";
import type { RunFact } from "./types";
import type { WorkflowSnapshot } from "../workflows/state";

export interface RunProjection {
  runId: string;
  state: string;
  workflow?: {
    id: string;
    phase: WorkflowSnapshot["phase"];
    goal: string;
    reason?: string;
  };
  goal?: {
    condition: string;
    status: GoalSnapshot["status"];
    turns: number;
    tokensUsed: number;
    reason?: string;
  };
  delegations: Array<{
    nodeId: string;
    attempt: number;
    state: "accepted" | "awaiting_evidence" | "failed";
    reason?: string;
  }>;
  recovery: Array<Extract<RunFact, { kind: "recovery_outcome" }>["outcome"]>;
  acceptance?: Extract<RunFact, { kind: "acceptance_verdict" }>;
  warnings: string[];
}

function isRunFact(value: unknown): value is RunFact {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as { version?: unknown }).version === 1
    && typeof (value as { kind?: unknown }).kind === "string"
    && typeof (value as { runId?: unknown }).runId === "string"
    && typeof (value as { sequence?: unknown }).sequence === "number";
}

export function reduceRunFacts(facts: readonly unknown[]): RunProjection | undefined {
  const valid = facts.filter(isRunFact).sort((a, b) => a.sequence - b.sequence);
  if (valid.length === 0) return undefined;
  const runId = valid[0].runId;
  const delegations = new Map<string, RunProjection["delegations"][number]>();
  const recovery: RunProjection["recovery"] = [];
  let acceptance: RunProjection["acceptance"];
  const warnings = facts.length === valid.length ? [] : ["run projection degraded: unsupported fact version or shape was ignored"];
  for (const fact of valid) {
    if (fact.runId !== runId) {
      warnings.push("run projection ignored a fact from another run");
      continue;
    }
    switch (fact.kind) {
      case "delegation_settled":
        delegations.set(fact.nodeId, {
          nodeId: fact.nodeId,
          attempt: fact.attempt,
          state: fact.state,
          ...(fact.reason === undefined ? {} : { reason: fact.reason }),
        });
        break;
      case "recovery_outcome":
        recovery.push(fact.outcome);
        break;
      case "acceptance_verdict":
        acceptance = fact;
        break;
      case "workflow_transition":
        break;
      default: {
        const exhaustive: never = fact;
        return exhaustive;
      }
    }
  }
  const failed = [...delegations.values()].some((entry) => entry.state === "failed" || entry.state === "awaiting_evidence");
  return {
    runId,
    state: failed ? "blocked" : acceptance?.verdict === "accepted" ? "accepted" : "in_progress",
    delegations: [...delegations.values()],
    recovery,
    ...(acceptance === undefined ? {} : { acceptance }),
    warnings,
  };
}

export function buildCurrentRunProjection(input: {
  facts: readonly unknown[];
  goal?: GoalSnapshot;
  workflow?: WorkflowSnapshot;
}): RunProjection | undefined {
  const projection = reduceRunFacts(input.facts);
  if (!projection) return undefined;
  return {
    ...projection,
    ...(input.workflow
      ? {
          workflow: {
            id: input.workflow.workflowId,
            phase: input.workflow.phase,
            goal: input.workflow.goal,
            ...("reason" in input.workflow ? { reason: input.workflow.reason } : {}),
          },
        }
      : {}),
    ...(input.goal
      ? {
          goal: {
            condition: input.goal.condition,
            status: input.goal.status,
            turns: input.goal.turnsEvaluated,
            tokensUsed: input.goal.tokensUsed,
            ...(input.goal.lastReason === undefined ? {} : { reason: input.goal.lastReason }),
          },
        }
      : {}),
  };
}
