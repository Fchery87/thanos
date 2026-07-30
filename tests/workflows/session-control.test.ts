import { describe, expect, it, vi } from "vitest";
import { registerWorkflowSessionGuards } from "../../src/workflows/session-control";
import { WorkflowRuntime } from "../../src/workflows/state";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

describe("Waves session control", () => {
  it("blocks ordinary session replacement, fork, and tree navigation while active", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const pi = {
      on: vi.fn((name: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(name, handler);
      }),
    };
    const runtime = new WorkflowRuntime({ createId: () => "workflow-1" });
    runtime.start({ goal: "implement", mode: "standalone" });

    registerWorkflowSessionGuards(pi as unknown as Pick<ExtensionAPI, "on">, runtime);

    expect(await handlers.get("session_before_switch")?.({}, {})).toEqual({ cancel: true });
    expect(await handlers.get("session_before_fork")?.({}, {})).toEqual({ cancel: true });
    expect(await handlers.get("session_before_tree")?.({}, {})).toEqual({ cancel: true });
  });

  it("allows session navigation after a workflow becomes terminal", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const pi = {
      on: vi.fn((name: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(name, handler);
      }),
    };
    const runtime = new WorkflowRuntime({ createId: () => "workflow-1" });
    runtime.start({ goal: "implement", mode: "standalone" });
    runtime.cancel("operator_cancelled");

    registerWorkflowSessionGuards(pi as unknown as Pick<ExtensionAPI, "on">, runtime);

    expect(await handlers.get("session_before_switch")?.({}, {})).toBeUndefined();
  });
});
