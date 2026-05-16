import type { Capability } from "../permissions/rules";

export type SpecTier = "instant" | "ambient" | "explicit";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected";
export type EvidenceRequirement = "diff" | "test" | "command" | "manual";
export type SpecStatus = "active" | "completed" | "abandoned";

export interface AcceptanceCriterion {
  id: string;
  statement: string;
  evidenceRequired: EvidenceRequirement[];
}

export interface FormalSpec {
  id: string;
  tier: SpecTier;
  status: SpecStatus;
  approvalStatus: ApprovalStatus;
  goal: string;
  allowedCapabilities: Capability[];
  constraints: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  targetFiles: string[];
  risks: string[];
  createdAt: number;
}
