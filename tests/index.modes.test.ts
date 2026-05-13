import { afterEach, describe, expect, it, vi } from "vitest";

import register from "../src/index";

type AnyHandler = (...args: unknown[]) => unknown;

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  vi.clearAllMocks();
});

describe("register /modes command", () => {
  it("opens a selector and stores the chosen default task mode for the session", async () => {
    const handlers = new Map<string, AnyHandler>();
    const registerTool = vi.fn();
    const registerCommand = vi.fn((name: string, definition: any) => {
      handlers.set(name, definition.handler);
    });
    const select = vi.fn(async () => "plan");
    const notify = vi.fn();
    const fakePi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn(() => false),
      on: vi.fn(),
      registerTool,
      registerCommand,
      registerShortcut: vi.fn(),
    };

    register(fakePi as any);

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
    const handlers = new Map<string, AnyHandler>();
    const registerTool = vi.fn((definition: any) => {
      handlers.set(definition.name, definition.execute);
    });
    const registerCommand = vi.fn((name: string, definition: any) => {
      handlers.set(name, definition.handler);
    });
    const select = vi.fn(async () => "build");
    const fakePi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn(() => false),
      on: vi.fn(),
      registerTool,
      registerCommand,
      registerShortcut: vi.fn(),
    };

    register(fakePi as any, { executeTask: mockExecuteTask });

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
