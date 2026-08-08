import type { DelegationOutcome } from "../delegation/runtime";
import type { RunProjection } from "../execution/projection";
import type { Capability } from "../permissions/rules";
import type {
  RepositoryRevisionIdentity,
  SessionEntryLike,
  WorkflowMode,
  WorkflowSnapshot,
} from "./state";

export interface WorkflowNode {
  id: string;
  agent: string;
  task: string;
  dependsOn: string[];
  required: boolean;
  result?: { kind: "text" } | { kind: "structured"; schema: Record<string, unknown> };
}

export interface WorkflowPlan {
  id: string;
  goal: string;
  maxConcurrency: number;
  nodes: WorkflowNode[];
}

export type IntegrationEvidenceRequirement = "diff" | "test" | "command";

export interface IntegrationCriterion {
  id: string;
  statement: string;
  evidenceRequired: IntegrationEvidenceRequirement[];
  evidenceAnyOf?: IntegrationEvidenceRequirement[][];
}

export interface IntegrationContract {
  targetRoots: string[];
  capabilities: Capability[];
  criteria: IntegrationCriterion[];
  limits: {
    maxIntegrationTurns: number;
    maxJuryRounds: number;
  };
}

export interface WavePlan extends WorkflowPlan {
  integration: IntegrationContract;
}

export interface WorkflowNodeResult {
  node: WorkflowNode;
  outcome: DelegationOutcome;
}

export interface WorkflowRunResult {
  state: "completed" | "awaiting_evidence" | "invalid_plan";
  results: WorkflowNodeResult[];
  reasons: string[];
}

/** Commands accepted by the WorkflowModule coordination seam. */
export type WorkflowCommand =
  | { kind: "start"; request: { goal: string; mode: WorkflowMode; lineageParentId?: string } }
  | { kind: "restore"; entries: readonly SessionEntryLike[]; pauseActiveReason?: string }
  | { kind: "signal"; signal: WorkflowSignal };

export type WorkflowSignal =
  | { id?: string; kind: "approval"; plan: WavePlan }
  | { id?: string; kind: "parent_turn_ended" }
  | { id?: string; kind: "yield"; yieldIdentity: RepositoryRevisionIdentity }
  | { id?: string; kind: "pause"; reason: string }
  | { id?: string; kind: "resume"; maxIntegrationTurns?: number; maxJuryRounds?: number }
  | { id?: string; kind: "cancel"; reason: string }
  | { id?: string; kind: "handoff"; destinationWorkflowId?: string }
  | { id?: string; kind: "goal_completion_claim" };

/**
 * A command result, not acceptance evidence. SpecEngine remains the sole
 * authority that can accept the operator task.
 */
export type WorkflowReceipt =
  | { state: "settled"; command: WorkflowCommand["kind"]; snapshot?: WorkflowSnapshot }
  | { state: "rejected"; command: WorkflowCommand["kind"]; reason: string; snapshot?: WorkflowSnapshot };

/** Read-only workflow state plus the optional Phase 3 observation projection. */
export interface WorkflowView {
  snapshot: WorkflowSnapshot;
  projection?: RunProjection;
}

/** The only public workflow boundary: command dispatch and read-only inspection. */
export interface WorkflowModule {
  dispatch(command: WorkflowCommand, signal?: AbortSignal): Promise<WorkflowReceipt>;
  inspect(): WorkflowView | undefined;
}
