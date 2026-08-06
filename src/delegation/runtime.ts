import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  SUBAGENT_DELEGATION_CANCEL_EVENT,
  SUBAGENT_DELEGATION_REQUEST_EVENT,
  SUBAGENT_DELEGATION_RESPONSE_EVENT,
} from "pi-subagents/delegation";
import {
  validateDelegationEvidence,
  type DelegationEvidenceVerdict,
  type DelegationRequest,
} from "./evidence";

type EventBus = ExtensionAPI["events"];

export interface DelegationInput extends Omit<DelegationRequest, "requestId" | "ownerRunId"> {
  requestId?: string;
}

export type DelegationOutcome =
  | DelegationEvidenceVerdict
  | { state: "failed"; reason: string };

export class DelegationRuntime {
  constructor(
    private readonly events: EventBus,
    private readonly ownerRunId: string,
  ) {
    if (!ownerRunId.trim()) throw new Error("DelegationRuntime requires the live Pi session identity");
  }

  delegate(input: DelegationInput, signal?: AbortSignal): Promise<DelegationOutcome> {
    const requestId = input.requestId ?? randomUUID();
    const request: DelegationRequest = {
      ...input,
      requestId,
      ownerRunId: this.ownerRunId,
    };
    const identity = { requestId, ownerRunId: this.ownerRunId, nodeId: input.nodeId };
    const timeoutMs = Math.max(1, input.timeoutMs ?? 120_000);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome: DelegationOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe?.();
        signal?.removeEventListener("abort", abort);
        resolve(outcome);
      };
      // 0.41.0 correlates a cancel by the identity tuple alone; a `version`
      // field here is rejected as unsupported and the cancel is dropped.
      const cancel = () => this.events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, { ...identity });
      const abort = () => {
        cancel();
        finish({ state: "failed", reason: "delegation cancelled" });
      };
      const unsubscribe = this.events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, (raw) => {
        const response = raw as Partial<DelegationEvidenceEnvelopeLike> | undefined;
        if (!response || response.requestId !== requestId) return;
        finish(validateDelegationEvidence(raw, identity, request.result));
      });
      const timer = setTimeout(() => {
        cancel();
        finish({ state: "failed", reason: `delegation timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
    });
  }
}

interface DelegationEvidenceEnvelopeLike {
  requestId: string;
}
