import type { DelegationEvidenceEnvelope } from "../delegation/evidence";
import type { SnapshotOutcome } from "../security/snapshot";
import type { WorkflowSnapshot } from "../workflows/state";

export const RUN_FACT_VERSION = 1 as const;

export type RunFact =
  | {
      version: typeof RUN_FACT_VERSION;
      kind: "delegation_settled";
      runId: string;
      sequence: number;
      nodeId: string;
      attempt: number;
      state: "accepted" | "awaiting_evidence" | "failed";
      reason?: string;
      requestId?: string;
    }
  | {
      version: typeof RUN_FACT_VERSION;
      kind: "workflow_transition";
      runId: string;
      sequence: number;
      from?: WorkflowSnapshot["phase"];
      to: WorkflowSnapshot["phase"];
      workflowId: string;
      reason?: string;
    }
  | {
      version: typeof RUN_FACT_VERSION;
      kind: "recovery_outcome";
      runId: string;
      sequence: number;
      outcome: SnapshotOutcome;
    }
  | {
      version: typeof RUN_FACT_VERSION;
      kind: "acceptance_verdict";
      runId: string;
      sequence: number;
      verdict: "accepted" | "rejected" | "incomplete";
      reasons: string[];
    };

export interface EvidenceReceiptV1 {
  version: 1;
  runId: string;
  sequence: number;
  nodeId: string;
  attempt: number;
  state: "accepted" | "awaiting_evidence" | "failed";
  requestId?: string;
  launchContractDigest?: string;
  artifacts: Array<{ path: string; sha256: string; bytes?: number }>;
  boundedOutputTail?: string;
  outputSha256?: string;
  truncated?: boolean;
  reason?: string;
}

export function delegationFact(
  runId: string,
  sequence: number,
  nodeId: string,
  attempt: number,
  outcome: Pick<Extract<RunFact, { kind: "delegation_settled" }>, "state" | "reason"> & { requestId?: string },
): RunFact {
  return {
    version: RUN_FACT_VERSION,
    kind: "delegation_settled",
    runId,
    sequence,
    nodeId,
    attempt,
    ...outcome,
  };
}

export function receiptFromDelegation(
  runId: string,
  sequence: number,
  nodeId: string,
  attempt: number,
  outcome: { state: "accepted"; envelope: DelegationEvidenceEnvelope },
): EvidenceReceiptV1 {
  return {
    version: 1,
    runId,
    sequence,
    nodeId,
    attempt,
    state: "accepted",
    requestId: outcome.envelope.requestId,
    launchContractDigest: outcome.envelope.launchContractDigest,
    artifacts: outcome.envelope.artifacts.map((artifact) => ({
      path: artifact.path,
      sha256: artifact.sha256,
      ...(artifact.bytes === undefined ? {} : { bytes: artifact.bytes }),
    })),
  };
}
