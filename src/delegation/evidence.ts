// pi-subagents 0.41.0 collapsed the V1/V2 delegation protocols into one
// unnumbered protocol and, for the first time, exported the evidence types
// publicly via `pi-subagents/shared-types`. These are the same shapes the old
// `SubagentDelegation*Result` family described, now named at their source
// instead of re-declared — which is what ADR 0019 asked for and could not have.
import type {
  SubagentDelegationUsage,
  SubagentDelegationValue,
} from "pi-subagents/delegation";
import type {
  AcceptanceInput,
  AcceptanceLedger,
  ExecutionProjection,
  ReviewProjection,
  SingleResult,
} from "pi-subagents/shared-types";

// `EffectsProjection` is the one evidence type 0.41.0 does not re-export from
// ./shared-types, so it can only be reached structurally through SingleResult.
// Filed as part of the upstream PR; swap to a direct import once it lands.
type EffectsProjection = NonNullable<SingleResult["effects"]>;

/**
 * What the harness actually guarantees about an acceptance ledger it received.
 *
 * Upstream sends the full `AcceptanceLedger`, but this envelope is a payload
 * validated structurally at runtime, not a compile-time contract — and the only
 * field the gate inspects is `status` (residual risks are flattened to the
 * envelope's own top-level `residualRisks`). Requiring the whole ledger would
 * oblige every fixture to fabricate `effectiveAcceptance`, `criteria`,
 * `runtimeChecks` and `verifyRuns` to assert nothing. The richer fields stay
 * available and typed for anything that later wants them.
 */
export type DelegationAcceptanceEvidence =
  Pick<AcceptanceLedger, "status" | "evidenceStatus" | "explicit"> & Partial<AcceptanceLedger>;

export interface DelegationArtifactEvidence {
  kind: string;
  path: string;
  sha256: string;
  bytes?: number;
}

export interface DelegationEvidenceEnvelope {
  requestId: string;
  ownerRunId: string;
  nodeId: string;
  runId: string;
  status: string;
  launchContractDigest: string;
  execution: ExecutionProjection;
  acceptance: DelegationAcceptanceEvidence;
  review: ReviewProjection;
  effects: EffectsProjection;
  artifacts: DelegationArtifactEvidence[];
  result?: SubagentDelegationValue;
  usage?: SubagentDelegationUsage;
  warnings: string[];
  residualRisks: string[];
}

export interface DelegationEvidenceIdentity {
  requestId: string;
  ownerRunId: string;
  nodeId: string;
}

export type DelegationEvidenceVerdict =
  | { state: "accepted"; envelope: DelegationEvidenceEnvelope }
  | { state: "awaiting_evidence"; reasons: string[] };

/**
 * Named without a protocol version because 0.41.0 has none: `version` is now
 * rejected as an unsupported delegation field, so sending it fails the request.
 */
export interface DelegationRequest extends DelegationEvidenceIdentity {
  agent: string;
  task: string;
  context: "fresh" | "fork";
  cwd: string;
  acceptance: AcceptanceInput;
  artifacts: boolean;
  result: { kind: "text" } | { kind: "structured"; schema: Record<string, unknown> };
  timeoutMs?: number;
  turnBudget?: { maxTurns: number; graceTurns?: number };
  toolBudget?: { soft?: number; hard: number; block?: string[] | "*" };
  skill?: string | string[] | boolean;
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validArtifacts(value: unknown): value is DelegationArtifactEvidence[] {
  return Array.isArray(value) && value.every((entry) => {
    const artifact = record(entry);
    return !!artifact
      && nonEmpty(artifact.kind)
      && nonEmpty(artifact.path)
      && typeof artifact.sha256 === "string"
      && /^[a-f0-9]{64}$/i.test(artifact.sha256);
  });
}

export function validateDelegationEvidence(
  value: unknown,
  expected: DelegationEvidenceIdentity,
): DelegationEvidenceVerdict {
  const response = record(value);
  if (!response) return { state: "awaiting_evidence", reasons: ["response is not an object"] };

  const reasons: string[] = [];
  for (const field of ["requestId", "ownerRunId", "nodeId"] as const) {
    if (response[field] !== expected[field]) reasons.push(`${field} does not match the workflow node`);
  }
  if (!nonEmpty(response.runId)) reasons.push("runId is missing");
  if (!nonEmpty(response.launchContractDigest) || !/^[a-f0-9]{64}$/i.test(response.launchContractDigest)) {
    reasons.push("executed launchContractDigest is missing or invalid");
  }
  if (!record(response.execution)) reasons.push("execution evidence is missing");
  if (!record(response.acceptance)) reasons.push("acceptance evidence is missing");
  if (!record(response.review)) reasons.push("review evidence is missing");
  if (!record(response.effects)) reasons.push("effects evidence is missing");
  if (!validArtifacts(response.artifacts)) reasons.push("artifact references must carry SHA-256 digests");
  if (!stringArray(response.warnings)) reasons.push("warnings are missing");
  if (!stringArray(response.residualRisks)) reasons.push("residual risks are missing");

  const acceptance = record(response.acceptance);
  if (response.status !== "completed") reasons.push(`delegation status is ${String(response.status)}`);
  if (record(response.execution)?.success !== true) reasons.push("execution did not succeed");
  // "checked" is an accepted state, "attested" is not, and that line is deliberate.
  //
  // Delegated waves nodes return evidence only — the main session owns all
  // mutation — so every child here is read-only. "checked" means the runtime
  // independently ran the criteria and structural checks over the child's
  // acceptance report and none failed. "attested" means the child merely claimed
  // it, with no check executed, so it stays refused.
  //
  // "verified" additionally requires the parent to execute a verify command.
  // That is real evidence for a writer, and no evidence at all for a node that
  // changed nothing: the command can only measure repo state the child never
  // touched. Requesting bare "verified" was in fact structurally unreachable —
  // it is rejected outright when no verify command is configured — so this gate
  // never admitted anything until now. Reaching "verified" via a nominal
  // always-passing command would write a stronger word into the ledger than the
  // evidence supports, which is the failure mode this gate exists to prevent.
  if (!acceptance || !["accepted", "verified", "reviewed", "checked"].includes(String(acceptance.status))) {
    reasons.push("acceptance did not reach an accepted evidence state");
  }
  if (record(response.review)?.status === "blockers") reasons.push("review reported blockers");
  if (record(response.effects)?.fileMutation && record(record(response.effects)?.fileMutation)?.status === "missing") {
    reasons.push("required file mutation evidence is missing");
  }

  if (reasons.length > 0) return { state: "awaiting_evidence", reasons };
  return { state: "accepted", envelope: response as unknown as DelegationEvidenceEnvelope };
}
