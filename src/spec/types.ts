import type { Capability } from "../permissions/rules";
import type { TaskContract, TaskCriterionSource } from "./task-contract";
import type { WavePlan } from "../workflows/types";

export type SpecTier = "instant" | "ambient" | "explicit";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected";
export type EvidenceRequirement = "diff" | "test" | "command" | "manual" | "workflow";

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
  /**
   * Where this criterion came from. Carried through from
   * {@link TaskCriterion.source} so the continuation gate can tell a criterion
   * that describes the user's actual request from a generic template — the gate
   * only ever acts on the former (see `gatedFailures`). Optional because a
   * hand-built criterion (tests, the no-criteria warning) has no task contract
   * behind it; absent means "unknown provenance", which stays gated.
   */
  source?: TaskCriterionSource;
}

export interface FormalSpec {
  id: string;
  tier: SpecTier;
  approvalStatus: ApprovalStatus;
  goal: string;
  taskContract: TaskContract;
  allowedCapabilities: Capability[];
  constraints: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  targetFiles: string[];
  risks: string[];
  workflowPlan?: WavePlan;
  createdAt: number;
}
