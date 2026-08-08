import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "../../src/index";
import { WORKFLOW_JOURNAL_ENTRY, WorkflowRuntime } from "../../src/workflows/state";
import type { WavePlan } from "../../src/workflows/types";

type Handler = (...args: unknown[]) => unknown;
type RegisterApi = Parameters<typeof register>[0];

function createFakePi(overrides?: Partial<RegisterApi>) {
  const handlers = new Map<string, Handler>();
  const eventHandlers = new Map<string, Handler>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const requests: unknown[] = [];
  const events = {
    on: (name: string, listener: (value: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    },
    emit: (name: string, value: unknown) => {
      if (name === "prompt-template:subagent:request") {
        requests.push(value);
        const request = value as { requestId: string; ownerRunId: string; nodeId: string };
        queueMicrotask(() => {
          for (const listener of listeners.get("prompt-template:subagent:response") ?? []) {
            listener({
              requestId: request.requestId,
              ownerRunId: request.ownerRunId,
              nodeId: request.nodeId,
              status: "completed",
            });
          }
        });
      }
    },
  };
  const api = {
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => false),
    on: vi.fn((name: string, handler: Handler) => {
      eventHandlers.set(name, handler);
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn((name: string, definition: { handler: Handler }) => {
      handlers.set(name, definition.handler);
    }),
    registerShortcut: vi.fn(),
    appendEntry: vi.fn(),
    sendUserMessage: vi.fn(async () => undefined),
    getThinkingLevel: vi.fn(() => "off"),
    getCommands: vi.fn(() => []),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    events,
    ...overrides,
  };
  return { api: api as unknown as RegisterApi, handlers, eventHandlers, requests };
}

const originalCwd = process.cwd();

beforeEach(async () => {
  process.chdir(await mkdtemp(join(tmpdir(), "harness-waves-register-")));
});

afterEach(() => {
  process.chdir(originalCwd);
});

describe("/waves command", () => {
  it("dispatches through the V2 DelegationRuntime and fails closed on incomplete evidence", async () => {
    const sendUserMessage = vi.fn(async () => undefined);
    const notify = vi.fn();
    const { api, handlers, requests } = createFakePi({ sendUserMessage } as Partial<RegisterApi>);
    register(api);

    await handlers.get("waves")?.("audit this repo", {
      hasUI: true,
      cwd: process.cwd(),
      sessionManager: {
        getSessionFile: () => "/tmp/session.jsonl",
        getSessionId: () => "session-1",
      },
      ui: { notify, setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ nodeId: "wave_plan", task: expect.stringContaining("audit this repo") });
    // toMatchObject is a partial match, so it would still pass if `version` crept
    // back in. pi-subagents 0.41.0 rejects the whole request as an unsupported
    // field, so assert its absence explicitly.
    expect(requests[0]).not.toHaveProperty("version");
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("awaiting_evidence"), "warning");
  });

  it("shows status when no arguments are provided", async () => {
    const sendUserMessage = vi.fn(async () => undefined);
    const notify = vi.fn();
    const { api, handlers } = createFakePi({ sendUserMessage } as Partial<RegisterApi>);
    register(api);

    await handlers.get("waves")?.("  ", {
      hasUI: true,
      ui: { notify, setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    });

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Waves — no workflow on the active session branch.", "info");
  });

  it("hands off into a new paused workflow identity and restores the source if replacement is cancelled", async () => {
    const notify = vi.fn();
    const appendEntry = vi.fn();
    const { api, handlers } = createFakePi({ appendEntry } as Partial<RegisterApi>);
    register(api);
    const baseContext = {
      hasUI: true,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      sessionManager: {
        getSessionFile: () => "/tmp/session.jsonl",
        getSessionId: () => "session-1",
      },
      ui: { notify, setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    };

    await handlers.get("waves")?.("audit this repo", baseContext);

    const destinationEntries: unknown[] = [];
    const newSession = vi.fn(async (options: {
      setup?: (manager: { appendCustomEntry: (type: string, data: unknown) => void }) => Promise<void>;
    }) => {
      await options.setup?.({
        appendCustomEntry: (type, data) => destinationEntries.push({ type, data }),
      });
      return { cancelled: false };
    });
    await handlers.get("waves")?.("handoff", { ...baseContext, newSession });

    expect(newSession).toHaveBeenCalledTimes(1);
    expect(destinationEntries).toEqual([
      expect.objectContaining({
        type: "thanos-waves-workflow",
        data: expect.objectContaining({
          phase: "paused",
          reason: "handoff_requires_approval",
          lineageParentId: expect.any(String),
        }),
      }),
    ]);
    expect(appendEntry).toHaveBeenCalledWith(
      "thanos-waves-workflow",
      expect.objectContaining({ phase: "handed_off" }),
    );

    const cancelled = vi.fn(async () => ({ cancelled: true }));
    const second = createFakePi({ appendEntry: vi.fn() } as Partial<RegisterApi>);
    register(second.api);
    await second.handlers.get("waves")?.("audit this repo", baseContext);
    await second.handlers.get("waves")?.("handoff", { ...baseContext, newSession: cancelled });
    expect((second.api.appendEntry as ReturnType<typeof vi.fn>)).toHaveBeenLastCalledWith(
      "thanos-waves-workflow",
      expect.objectContaining({ phase: "paused", reason: "session_replacement_cancelled" }),
    );

    const failed = createFakePi({ appendEntry: vi.fn() } as Partial<RegisterApi>);
    register(failed.api);
    await failed.handlers.get("waves")?.("audit this repo", baseContext);
    await failed.handlers.get("waves")?.("handoff", {
      ...baseContext,
      newSession: vi.fn(async () => { throw new Error("replacement failed"); }),
    });
    expect((failed.api.appendEntry as ReturnType<typeof vi.fn>)).toHaveBeenLastCalledWith(
      "thanos-waves-workflow",
      expect.objectContaining({ phase: "paused", reason: "session_replacement_failed" }),
    );
  });

  it("reconstructs and resumes a non-planning phase with a fresh Work Contract", async () => {
    const plan: WavePlan = {
      id: "wave",
      goal: "resume safely",
      maxConcurrency: 1,
      integration: {
        targetRoots: ["src"],
        capabilities: ["read"],
        criteria: [{ id: "done", statement: "Done", evidenceRequired: ["command"] }],
        limits: { maxIntegrationTurns: 3, maxJuryRounds: 2 },
      },
      nodes: [{ id: "inspect", agent: "explore", task: "inspect", dependsOn: [], required: true }],
    };
    const journal = new WorkflowRuntime({ createId: () => "workflow-1", now: () => 42 });
    journal.start({ goal: "resume safely", mode: "standalone" });
    journal.bindPlan(plan);
    journal.pause("restart_requires_approval");
    const notify = vi.fn();
    const { api, handlers, eventHandlers, requests } = createFakePi();
    register(api);
    const sessionManager = {
      getBranch: () => [{
        type: "custom",
        customType: WORKFLOW_JOURNAL_ENTRY,
        data: journal.current,
      }],
      getSessionFile: () => "/tmp/session.jsonl",
      getSessionId: () => "session-1",
    };
    const ui = {
      notify,
      setStatus: vi.fn(),
      confirm: vi.fn(async () => true),
      theme: {
        fg: (_kind: string, text: string) => text,
        bold: (text: string) => text,
      },
    };

    await eventHandlers.get("session_tree")?.({}, { sessionManager, ui });
    await handlers.get("waves")?.("resume", {
      hasUI: true,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      sessionManager,
      ui,
    });

    expect(requests.at(-1)).toMatchObject({ nodeId: "inspect" });
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("approval_declined"), "warning");

    const denied = createFakePi();
    register(denied.api);
    const deniedNotify = vi.fn();
    const deniedUi = {
      ...ui,
      notify: deniedNotify,
      confirm: vi.fn(async () => false),
    };
    await denied.eventHandlers.get("session_tree")?.({}, { sessionManager, ui: deniedUi });
    await denied.handlers.get("waves")?.("resume", {
      hasUI: true,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      sessionManager,
      ui: deniedUi,
    });
    expect(deniedNotify).toHaveBeenCalledWith(
      expect.stringContaining("user rejected Work Contract"),
      "warning",
    );
  });

  it("pauses active workflow state when switching session branches", async () => {
    const plan: WavePlan = {
      id: "wave",
      goal: "resume safely",
      maxConcurrency: 1,
      integration: {
        targetRoots: ["src"],
        capabilities: ["read"],
        criteria: [{ id: "done", statement: "Done", evidenceRequired: ["command"] }],
        limits: { maxIntegrationTurns: 3, maxJuryRounds: 2 },
      },
      nodes: [{ id: "inspect", agent: "explore", task: "inspect", dependsOn: [], required: true }],
    };
    const journal = new WorkflowRuntime({ createId: () => "workflow-1", now: () => 42 });
    journal.start({ goal: "resume safely", mode: "standalone" });
    journal.bindPlan(plan);
    journal.approve();
    const { api, eventHandlers } = createFakePi();
    register(api);
    const ui = { notify: vi.fn(), setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } };
    await eventHandlers.get("session_tree")?.({}, {
      sessionManager: {
        getBranch: () => [{ type: "custom", customType: WORKFLOW_JOURNAL_ENTRY, data: journal.current }],
      },
      ui,
    });
    expect((api.appendEntry as ReturnType<typeof vi.fn>)).toHaveBeenLastCalledWith(
      WORKFLOW_JOURNAL_ENTRY,
      expect.objectContaining({ phase: "paused", reason: "branch_switch_requires_approval" }),
    );
  });

  it("returns continuation ownership and a fresh contract to an attached Goal on cancel", async () => {
    const sendUserMessage = vi.fn(async () => undefined);
    const { api, handlers } = createFakePi({ sendUserMessage } as Partial<RegisterApi>);
    register(api);
    const notify = vi.fn();
    const context = {
      hasUI: true,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      isProjectTrusted: () => true,
      getContextUsage: () => ({ tokens: 0 }),
      sessionManager: {
        getSessionFile: () => "/tmp/session.jsonl",
        getSessionId: () => "session-1",
      },
      ui: {
        notify,
        setStatus: vi.fn(),
        confirm: vi.fn(async () => true),
        theme: { fg: (_kind: string, text: string) => text, bold: (text: string) => text },
      },
    };
    await handlers.get("goal")?.("keep authentication safe", context);
    sendUserMessage.mockClear();
    await handlers.get("waves")?.("goal", context);
    sendUserMessage.mockClear();

    await handlers.get("waves")?.("cancel", context);

    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("[harness:goal-directive]"),
      { deliverAs: "followUp" },
    );
  });
});
