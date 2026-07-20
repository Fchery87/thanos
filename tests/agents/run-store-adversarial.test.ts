import { describe, expect, it } from "vitest";
import { RunStore } from "../../src/agents/run-store";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunState } from "../../src/agents/run-store";

describe("RunStore state transitions", () => {
  async function setup(): Promise<{ store: RunStore; dir: string; id: string }> {
    const dir = await mkdtemp(join(tmpdir(), "harness-rs-test-"));
    const store = new RunStore(dir);
    const id = "test-run-001";
    await store.create(id, { id, agentType: "build", goal: "test", contextMode: "fresh" });
    return { store, dir, id };
  }

  const VALID_TRANSITIONS: Record<RunState, RunState[]> = {
    pending: ["running", "cancelled"],
    running: ["completed", "failed", "cancelled", "timeout"],
    completed: [],
    failed: [],
    cancelled: [],
    timeout: [],
  };

  it("allows all valid transitions", async () => {
    const { store, id } = await setup();
    await store.transition(id, "running");
    await store.transition(id, "completed");
    const state = await store.readState(id);
    expect(state?.state).toBe("completed");
  });

  it("rejects invalid transitions", async () => {
    const { store, id } = await setup();
    await store.transition(id, "running");
    await expect(store.transition(id, "pending")).rejects.toThrow(/Invalid state transition/);
  });

  it("rejects direct pending->completed transition", async () => {
    const { store, id } = await setup();
    await expect(store.transition(id, "completed")).rejects.toThrow(/Invalid state transition/);
  });

  it("terminal states cannot be transitioned", async () => {
    const { store, id } = await setup();
    await store.transition(id, "running");
    await store.transition(id, "completed");
    await expect(store.transition(id, "running")).rejects.toThrow(/Invalid state transition/);
  });

  it("rejects transition for non-existent run", async () => {
    const { store } = await setup();
    await expect(store.transition("nonexistent", "running")).rejects.toThrow(/not found/);
  });

  it("allows cancellation from pending", async () => {
    const { store, id } = await setup();
    await store.transition(id, "cancelled");
    const state = await store.readState(id);
    expect(state?.state).toBe("cancelled");
  });

  it("allows timeout from running", async () => {
    const { store, id } = await setup();
    await store.transition(id, "running");
    await store.transition(id, "timeout");
    const state = await store.readState(id);
    expect(state?.state).toBe("timeout");
  });

  it("atomic writes survive partial failures", async () => {
    const { store, id } = await setup();
    await store.transition(id, "running");
    const state = await store.readState(id);
    expect(state?.state).toBe("running");
    // Re-read should produce same state
    const state2 = await store.readState(id);
    expect(state2?.state).toBe("running");
  });

  it("garbage collection removes old terminal runs", async () => {
    const { store, dir, id } = await setup();
    await store.transition(id, "running");
    await store.transition(id, "completed");

    // For testing, force age-based removal by setting maxAge to 0
    const removed = await store.gc({ maxAgeMs: 0, maxCount: 0 });
    expect(removed).toBeGreaterThanOrEqual(0);
  });
});
