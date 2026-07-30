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
    acceptance: "verified" as const,
    artifacts: true,
    result: { kind: "text" as const },
    timeoutMs: 50,
  };
}

describe("DelegationRuntime", () => {
  it("emits V2 requests with the live owner identity and requested acceptance", () => {
    const bus = new Bus();
    void new DelegationRuntime(bus, "session-1").delegate(input());
    expect(bus.emitted[0]).toEqual({
      event: SUBAGENT_DELEGATION_REQUEST_EVENT,
      value: expect.objectContaining({
        version: 2,
        requestId: "request-1",
        ownerRunId: "session-1",
        nodeId: "node-1",
        acceptance: "verified",
      }),
    });
  });

  it("returns awaiting_evidence for the current incomplete upstream response", async () => {
    const bus = new Bus();
    const pending = new DelegationRuntime(bus, "session-1").delegate(input());
    bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
      version: 2,
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
      value: { version: 2, requestId: "request-1", ownerRunId: "session-1", nodeId: "node-1" },
    });
    vi.useRealTimers();
  });
});
