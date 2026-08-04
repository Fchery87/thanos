import type { GoalSnapshot } from "../goal/types";
import type { WorkflowSnapshot } from "../workflows/state";
import type { RunFact } from "./types";

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
  recovery: Array<Extract<RunFact, { kind: "recovery_outcome" }> ["outcome"]>;
  acceptance?: Extract<RunFact, { kind: "acceptance_verdict" }>;
  warnings: string[];
}

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function snapshotOutcome(value: unknown): boolean {
  const outcome = record(value);
  if (!outcome || !["succeeded", "skipped", "failed"].includes(String(outcome.state))) return false;
  if (!stringArray(outcome.limitations)) return false;
  return outcome.state === "succeeded"
    ? nonEmpty(outcome.reference)
    : nonEmpty(outcome.reason);
}

function isRunFact(value: unknown): value is RunFact {
  const fact = record(value);
  if (!fact
    || fact.version !== 1
    || !nonEmpty(fact.runId)
    || !Number.isInteger(fact.sequence)
    || Number(fact.sequence) <= 0
  ) return false;

  switch (fact.kind) {
    case "delegation_settled":
      return nonEmpty(fact.nodeId)
        && Number.isInteger(fact.attempt)
        && Number(fact.attempt) > 0
        && ["accepted", "awaiting_evidence", "failed"].includes(String(fact.state))
        && (fact.reason === undefined || typeof fact.reason === "string")
        && (fact.requestId === undefined || nonEmpty(fact.requestId))
        && (fact.workflowId === undefined || nonEmpty(fact.workflowId));
    case "workflow_transition":
      return nonEmpty(fact.workflowId)
        && typeof fact.to === "string"
        && (fact.from === undefined || typeof fact.from === "string")
        && (fact.reason === undefined || typeof fact.reason === "string");
    case "recovery_outcome":
      return snapshotOutcome(fact.outcome);
    case "acceptance_verdict":
      return ["accepted", "rejected", "incomplete"].includes(String(fact.verdict))
        && stringArray(fact.reasons)
        && (fact.workflowId === undefined || nonEmpty(fact.workflowId));
    default:
      return false;
  }
}

export function reduceRunFacts(
  facts: readonly unknown[],
  options: { workflowId?: string } = {},
): RunProjection | undefined {
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
    if ((fact.kind === "delegation_settled" || fact.kind === "acceptance_verdict")
      && fact.workflowId !== options.workflowId) continue;
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
  const active = input.workflow?.phase === "paused" ? input.workflow.resume : input.workflow;
  const projection = reduceRunFacts(input.facts, {
    ...(active && "workflowId" in active ? { workflowId: active.workflowId } : {}),
  });
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
