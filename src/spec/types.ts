import type { Capability } from "../permissions/rules";
import type { TaskContract } from "./task-contract";

export type SpecTier = "instant" | "ambient" | "explicit";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected";
export type EvidenceRequirement = "diff" | "test" | "command" | "manual";
export type SpecStatus = "active" | "completed" | "abandoned";

export interface AcceptanceCriterion {
  id: string;
  /** Every kind here must be matched (conjunction). */
  evidenceRequired: EvidenceRequirement[];
  /**
   * Optional alternative groups. Each inner group is a disjunction ("any of
   * these kinds satisfies it"); the groups are conjoined with each other and
   * with {@link evidenceRequired}. Use for a mutating criterion whose
   * verification can be shown more than one way — e.g. `[["test", "command"]]`
   * means "a passing test OR a passing command", without pre-guessing which.
   */
  evidenceAnyOf?: EvidenceRequirement[][];
  statement: string;
}

export interface FormalSpec {
  id: string;
  tier: SpecTier;
  status: SpecStatus;
  approvalStatus: ApprovalStatus;
  goal: string;
  taskContract: TaskContract;
  allowedCapabilities: Capability[];
  constraints: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  targetFiles: string[];
  risks: string[];
  createdAt: number;
}
