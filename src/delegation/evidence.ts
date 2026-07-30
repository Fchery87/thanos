import type {
  SubagentDelegationAcceptance,
  SubagentDelegationAcceptanceResult,
  SubagentDelegationEffectsResult,
  SubagentDelegationExecutionResult,
  SubagentDelegationReviewResult,
  SubagentDelegationV2Usage,
  SubagentDelegationV2Value,
} from "pi-subagents/delegation";

export interface DelegationArtifactEvidence {
  kind: string;
  path: string;
  sha256: string;
  bytes?: number;
}

export interface DelegationEvidenceEnvelope {
  version: 2;
  requestId: string;
  ownerRunId: string;
  nodeId: string;
  runId: string;
  status: string;
  launchContractDigest: string;
  execution: SubagentDelegationExecutionResult;
  acceptance: SubagentDelegationAcceptanceResult;
  review: SubagentDelegationReviewResult;
  effects: SubagentDelegationEffectsResult;
  artifacts: DelegationArtifactEvidence[];
  result?: SubagentDelegationV2Value;
  usage?: SubagentDelegationV2Usage;
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

export interface DelegationV2Request extends DelegationEvidenceIdentity {
  version: 2;
  agent: string;
  task: string;
  context: "fresh" | "fork";
  cwd: string;
  acceptance: SubagentDelegationAcceptance;
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
  if (response.version !== 2) reasons.push("protocol version is not 2");
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
  if (!acceptance || !["accepted", "verified", "reviewed"].includes(String(acceptance.status))) {
    reasons.push("acceptance did not reach an accepted evidence state");
  }
  if (record(response.review)?.status === "blockers") reasons.push("review reported blockers");
  if (record(response.effects)?.fileMutation && record(record(response.effects)?.fileMutation)?.status === "missing") {
    reasons.push("required file mutation evidence is missing");
  }

  if (reasons.length > 0) return { state: "awaiting_evidence", reasons };
  return { state: "accepted", envelope: response as unknown as DelegationEvidenceEnvelope };
}
