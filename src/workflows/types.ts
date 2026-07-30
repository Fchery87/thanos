import type { DelegationOutcome } from "../delegation/runtime";
import type { Capability } from "../permissions/rules";

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
