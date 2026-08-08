import { describe, expect, it, vi } from "vitest";
import {
  SUBAGENT_DELEGATION_CANCEL_EVENT,
  SUBAGENT_DELEGATION_REQUEST_EVENT,
  SUBAGENT_DELEGATION_RESPONSE_EVENT,
} from "pi-subagents/delegation";
import { DelegationRuntime } from "../../src/delegation/runtime";

class Bus {
  handlers = new Map<string, Set<(value: unknown) => void>>();
  emitted: Array<{ event: string; value: unknown }> = [];

  on(event: string, handler: (value: unknown) => void) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  emit(event: string, value: unknown) {
    this.emitted.push({ event, value });
    for (const handler of this.handlers.get(event) ?? []) handler(value);
  }
}

function input() {
  return {
    requestId: "request-1",
    nodeId: "node-1",
    agent: "explore",
    task: "inspect",
    context: "fresh" as const,
    cwd: "/repo",
    acceptance: "checked" as const,
    artifacts: true,
    result: { kind: "text" as const },
    timeoutMs: 50,
  };
}

describe("DelegationRuntime", () => {
  it("emits requests with the live owner identity, requested acceptance, and no protocol version", () => {
    const bus = new Bus();
    void new DelegationRuntime(bus, "session-1").delegate(input());
    expect(bus.emitted[0]).toEqual({
      event: SUBAGENT_DELEGATION_REQUEST_EVENT,
      value: expect.objectContaining({
        requestId: "request-1",
        ownerRunId: "session-1",
        nodeId: "node-1",
        acceptance: "checked",
      }),
    });
    // objectContaining is partial: pin the absence of the protocol version,
    // which 0.41.0 rejects as an unsupported delegation field.
    expect(bus.emitted[0].value).not.toHaveProperty("version");
  });

  it("returns awaiting_evidence for the current incomplete upstream response", async () => {
    // maxRepairAttempts: 0 — this test exercises the single-round-trip
    // evidence-validation wiring specifically; the repair loop that would
    // otherwise re-delegate on awaiting_evidence (default on, see
    // tests/delegation/repair.test.ts) has its own dedicated coverage.
    const bus = new Bus();
    const pending = new DelegationRuntime(bus, "session-1").delegate({ ...input(), maxRepairAttempts: 0 });
    bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
      requestId: "request-1",
      ownerRunId: "session-1",
      nodeId: "node-1",
      status: "completed",
      runId: "run-1",
      launchContractDigest: "a".repeat(64),
      result: { kind: "text", text: "done" },
    });
    expect((await pending).state).toBe("awaiting_evidence");
  });

  it("cancels the exact V2 attempt on timeout", async () => {
    vi.useFakeTimers();
    const bus = new Bus();
    const pending = new DelegationRuntime(bus, "session-1").delegate(input());
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual({ state: "failed", reason: "delegation timed out after 50ms" });
    expect(bus.emitted).toContainEqual({
      event: SUBAGENT_DELEGATION_CANCEL_EVENT,
      // Exact match, so this also pins that no `version` rides along on cancels.
      value: { requestId: "request-1", ownerRunId: "session-1", nodeId: "node-1" },
    });
    vi.useRealTimers();
  });
});
