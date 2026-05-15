import { afterEach, describe, expect, it, vi } from "vitest";
import register from "../src/index";

type Handler = (...args: unknown[]) => unknown;
type RegisterApi = Parameters<typeof register>[0];

afterEach(() => {
  vi.clearAllMocks();
});

function createFakePi(overrides?: Partial<RegisterApi>) {
  const handlers = new Map<string, Handler>();
  const api = {
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => false),
    on: vi.fn(),
    registerTool: vi.fn((definition: { name: string; execute: Handler }) => {
      handlers.set(definition.name, definition.execute);
    }),
    registerCommand: vi.fn((name: string, definition: { handler: Handler }) => {
      handlers.set(name, definition.handler);
    }),
    registerShortcut: vi.fn(),
    ...overrides,
  };
  return { api: api as unknown as RegisterApi, handlers };
}

describe("register /modes command", () => {
  it("opens a selector and stores the chosen default task mode for the session", async () => {
    const select = vi.fn(async () => "plan");
    const notify = vi.fn();
    const { api, handlers } = createFakePi();

    register(api);

    const modesHandler = handlers.get("modes");
    expect(modesHandler).toBeTypeOf("function");

    await modesHandler?.("", {
      hasUI: true,
      ui: {
        select,
        notify,
        setStatus: vi.fn(),
        theme: { fg: (_kind: string, text: string) => text },
      },
    });

    expect(select).toHaveBeenCalledWith("Choose a default subagent mode", ["explore", "plan", "build", "reviewer", "designer"]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Default subagent mode: plan"), "info");
  });

  it("reuses the selected mode for task calls that omit type", async () => {
    const mockExecuteTask = vi.fn(async () => "task result");
    const select = vi.fn(async () => "build");
    const { api, handlers } = createFakePi();

    register(api, { executeTask: mockExecuteTask });

    await handlers.get("modes")?.("", {
      hasUI: true,
      ui: {
        select,
        notify: vi.fn(),
        setStatus: vi.fn(),
        theme: { fg: (_kind: string, text: string) => text },
      },
    });

    await handlers.get("task")?.(
      "tool-call-1",
      { goal: "Implement something" },
      undefined,
      undefined,
      {
        hasUI: true,
        ui: { select: vi.fn(), notify: vi.fn(), setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
      },
    );

    expect(mockExecuteTask).toHaveBeenCalledWith(
      expect.objectContaining({ type: "build", goal: "Implement something" }),
      undefined,
      undefined,
      expect.anything(),
    );
  });
});
