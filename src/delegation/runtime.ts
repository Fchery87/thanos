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
  /**
   * How many times to re-delegate a child that returns `awaiting_evidence`,
   * with the rejection reasons appended to its task, before giving up.
   * Default 1 — Thanos's gate rejects on governance grounds too (missing
   * artifacts, absent acceptance), which do not become true on a retry, so
   * this stays a single bounded attempt rather than Atomic's three.
   * `failed` outcomes (timeout, cancellation) are never repaired — nothing
   * about the request was rejected, so re-asking with the same input would
   * not change anything.
   */
  maxRepairAttempts?: number;
}

export type DelegationOutcome =
  | DelegationEvidenceVerdict
  | { state: "failed"; reason: string };

function buildRepairTask(originalTask: string, reasons: readonly string[]): string {
  return [
    "Your previous attempt was rejected for the following reason(s):",
    ...reasons.map((reason) => `- ${reason}`),
    "",
    "Fix these issues and try again.",
    "",
    originalTask,
  ].join("\n");
}

export class DelegationRuntime {
  constructor(
    private readonly events: EventBus,
    private readonly ownerRunId: string,
  ) {
    if (!ownerRunId.trim()) throw new Error("DelegationRuntime requires the live Pi session identity");
  }

  async delegate(input: DelegationInput, signal?: AbortSignal): Promise<DelegationOutcome> {
    const requestId = input.requestId ?? randomUUID();
    const maxRepairAttempts = Math.max(0, input.maxRepairAttempts ?? 1);

    // DelegationInput carries two fields DelegationRequest doesn't have
    // (requestId, maxRepairAttempts). requestId is overwritten below
    // regardless, but a blind `...input` spread would let maxRepairAttempts
    // survive onto the wire payload unfixed — TypeScript's excess-property
    // check doesn't fire on a spread from a variable, only on object-literal
    // arguments, so this wouldn't be caught at compile time. pi-subagents
    // validates against a strict field allowlist and rejects the whole
    // request outright on anything outside it (the same failure mode already
    // guarded against for `version`, see attemptOnce below) — stripped here
    // rather than relying on that rejection as the safety net.
    const { requestId: _inputRequestId, maxRepairAttempts: _maxRepairAttempts, ...delegationFields } = input;

    let task = input.task;
    let repairsUsed = 0;
    while (true) {
      const request: DelegationRequest = { ...delegationFields, task, requestId, ownerRunId: this.ownerRunId };
      const outcome = await this.attemptOnce(request, signal);
      if (outcome.state !== "awaiting_evidence" || repairsUsed >= maxRepairAttempts) return outcome;
      repairsUsed += 1;
      // Built off the original task each time, not the previous repair's
      // task, so a second repair (if maxRepairAttempts is ever raised above
      // its default of 1) carries the latest reasons rather than an
      // ever-growing nest of "your previous attempt was rejected" preambles.
      task = buildRepairTask(input.task, outcome.reasons);
    }
  }

  private attemptOnce(request: DelegationRequest, signal?: AbortSignal): Promise<DelegationOutcome> {
    const identity = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
    const timeoutMs = Math.max(1, request.timeoutMs ?? 120_000);

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
        if (!response || response.requestId !== request.requestId) return;
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
