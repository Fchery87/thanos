import type { Capability } from "../permissions/rules";
import type { RiskTier } from "../permissions/risk";
import type { AuditTarget } from "../audit/types";
import type { EgressClass } from "./egress";

export type OperationKind = "tool" | "mcp_start" | "delegate" | "interaction" | "continuation";

export interface TrustPrincipal {
  kind: "parent" | "specialist" | "mcp_server" | "project_config" | "evaluator" | "user";
  id: string;
}

export interface GovernedOperation {
  kind: OperationKind;
  principal: TrustPrincipal;
  capability: Capability;
  target: string;
  riskTier: RiskTier;
  egressClass: EgressClass;
  auditTarget: AuditTarget;
  recognized: boolean;
  toolName?: string;
  input?: Record<string, unknown>;
}

export interface GovernedOperationResult {
  operation: GovernedOperation;
  allowed: boolean;
  failureReason?: string;
  evidenceCollected?: boolean;
  snapshotTaken?: boolean;
}
