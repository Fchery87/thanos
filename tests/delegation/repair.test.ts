import { describe, expect, it, vi } from "vitest";
import {
  SUBAGENT_DELEGATION_REQUEST_EVENT,
  SUBAGENT_DELEGATION_RESPONSE_EVENT,
} from "pi-subagents/delegation";
import { DelegationRuntime } from "../../src/delegation/runtime";

// Mirrors tests/delegation/runtime.test.ts's fake bus.
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
    task: "inspect the auth module",
    context: "fresh" as const,
    cwd: "/repo",
    acceptance: "checked" as const,
    artifacts: true,
    result: { kind: "text" as const },
    timeoutMs: 50,
  };
}

function incompleteResponse() {
  // Missing execution/acceptance/review/effects/artifacts/warnings/residualRisks
  // -> evidence.ts rejects this with several reasons, awaiting_evidence.
  return {
    requestId: "request-1",
    ownerRunId: "session-1",
    nodeId: "node-1",
    status: "completed",
    runId: "run-1",
    launchContractDigest: "a".repeat(64),
    result: { kind: "text", text: "done" },
  };
}

function completeResponse() {
  return {
    requestId: "request-1",
    ownerRunId: "session-1",
    nodeId: "node-1",
    runId: "child-run-1",
    status: "completed",
    launchContractDigest: "a".repeat(64),
    execution: { status: "completed", success: true, exitCode: 0 },
    acceptance: { status: "accepted", evidenceStatus: "verified", explicit: true },
    review: { status: "reviewed", findings: [] },
    effects: { fileMutation: { status: "observed", expected: true, attempted: true } },
    artifacts: [{ kind: "patch", path: ".harness/patch.diff", sha256: "b".repeat(64) }],
    warnings: [],
    residualRisks: [],
    result: { kind: "text", text: "done" },
  };
}

/**
 * Registers a REQUEST-event listener that synchronously auto-responds to
 * each attempt in order, using `responses[requests.length - 1]`. Avoids
 * fragile tick-counting: the runtime's RESPONSE listener for a given attempt
 * is registered before that attempt's REQUEST event fires (see
 * src/delegation/runtime.ts), so responding synchronously from within the
 * REQUEST handler always reaches the right listener before it unwinds.
 */
function autoRespond(bus: Bus, responses: Array<Record<string, unknown> | undefined>) {
  const requests: unknown[] = [];
  bus.on(SUBAGENT_DELEGATION_REQUEST_EVENT, (value) => {
    requests.push(value);
    const response = responses[requests.length - 1];
    if (response) bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, response);
  });
  return requests;
}

describe("DelegationRuntime repair loop", () => {
  it("re-delegates exactly once, with the rejection reasons appended to the task, when the first attempt is awaiting_evidence", async () => {
    const bus = new Bus();
    const requests = autoRespond(bus, [incompleteResponse(), completeResponse()]);

    const outcome = await new DelegationRuntime(bus, "session-1").delegate(input());

    expect(requests.length).toBe(2);
    expect(outcome.state).toBe("accepted");

    const repairRequest = requests[1] as { task: string; requestId: string };
    expect(repairRequest.task).toContain("execution evidence is missing");
    expect(repairRequest.task).toContain("inspect the auth module");
  });

  it("does not delegate a third time when the repair attempt is also awaiting_evidence", async () => {
    const bus = new Bus();
    const requests = autoRespond(bus, [incompleteResponse(), incompleteResponse()]);

    const outcome = await new DelegationRuntime(bus, "session-1").delegate(input());

    expect(requests.length).toBe(2);
    expect(outcome.state).toBe("awaiting_evidence");
  });

  it("does not repair a failed outcome — only schema/evidence rejections are repairable", async () => {
    vi.useFakeTimers();
    const bus = new Bus();
    const requests: unknown[] = [];
    bus.on(SUBAGENT_DELEGATION_REQUEST_EVENT, (value) => requests.push(value));

    const pending = new DelegationRuntime(bus, "session-1").delegate(input());
    await vi.advanceTimersByTimeAsync(50);
    const outcome = await pending;

    expect(requests.length).toBe(1);
    expect(outcome).toEqual({ state: "failed", reason: "delegation timed out after 50ms" });
    vi.useRealTimers();
  });

  it("preserves requestId lineage across both attempts", async () => {
    const bus = new Bus();
    const requests = autoRespond(bus, [incompleteResponse(), completeResponse()]);

    await new DelegationRuntime(bus, "session-1").delegate(input());

    expect(requests.length).toBe(2);
    const [first, second] = requests as Array<{ requestId: string }>;
    expect(first.requestId).toBe("request-1");
    expect(second.requestId).toBe("request-1");
  });

  it("respects maxRepairAttempts: 0 to disable repair entirely", async () => {
    const bus = new Bus();
    const requests = autoRespond(bus, [incompleteResponse(), completeResponse()]);

    const outcome = await new DelegationRuntime(bus, "session-1").delegate({
      ...input(),
      maxRepairAttempts: 0,
    });

    expect(requests.length).toBe(1);
    expect(outcome.state).toBe("awaiting_evidence");
  });
});
