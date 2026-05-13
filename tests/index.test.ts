import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import register from "../src/index";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe("register", () => {
  it("loads policy and blocks a sensitive read through the tool_call hook", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "harness-index-"));
    await writeFile(
      join(cwd, "harness.policy.json"),
      JSON.stringify({
        version: 1,
        preset: "team",
        rules: [
          {
            id: "project-deny-env",
            capability: "read",
            pattern: ".env*",
            decision: "deny",
            reason: "secret env file",
          },
        ],
        audit: { enabled: false },
        headless: { defaultDecision: "deny" },
      }),
      "utf-8",
    );
    process.chdir(cwd);

    type AnyHandler = (...args: unknown[]) => unknown;
    const handlers = new Map<string, AnyHandler>();
    const fakePi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn(() => false),
      on: vi.fn((name: string, handler: AnyHandler) => {
        handlers.set(name, handler);
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
    };

    register(fakePi as any);

    const toolCall = handlers.get("tool_call");
    expect(toolCall).toBeTypeOf("function");

    const result = await toolCall?.(
      { toolName: "read", input: { file_path: ".env.local" } },
      {
        hasUI: true,
        ui: {
          confirm: vi.fn(async () => true),
          notify: vi.fn(),
        },
      },
    );

    expect(result).toMatchObject({
      block: true,
      reason: expect.stringContaining("Blocked by policy project-deny-env"),
    });
  });

  it("formats explicit spec approval with scope and evidence", async () => {
    type AnyHandler = (...args: unknown[]) => unknown;
    const handlers = new Map<string, AnyHandler>();
    const confirm = vi.fn(async () => true);
    const fakePi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn(() => true),
      on: vi.fn((name: string, handler: AnyHandler) => {
        handlers.set(name, handler);
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
    };

    register(fakePi as any);

    const beforeAgentStart = handlers.get("before_agent_start");
    const toolCall = handlers.get("tool_call");

    await beforeAgentStart?.({ prompt: "Refactor the auth module" }, {
      model: undefined,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
    });
    await toolCall?.(
      { toolName: "write", input: { file_path: "src/auth.ts" } },
      {
        hasUI: true,
        ui: {
          confirm,
          notify: vi.fn(),
        },
      },
    );

    expect(confirm).toHaveBeenCalledWith(
      "Spec Approval Required",
      expect.stringContaining("Allowed capabilities:"),
    );
    expect(confirm).toHaveBeenCalledWith(
      "Spec Approval Required",
      expect.stringContaining("Evidence required:"),
    );
  });

  it("uses failure-grade verification messaging in headless runs", async () => {
    type AnyHandler = (...args: unknown[]) => unknown;
    const handlers = new Map<string, AnyHandler>();
    const notify = vi.fn();
    const fakePi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn(() => false),
      on: vi.fn((name: string, handler: AnyHandler) => {
        handlers.set(name, handler);
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
    };

    register(fakePi as any);

    const beforeAgentStart = handlers.get("before_agent_start");
    const agentEnd = handlers.get("agent_end");

    await beforeAgentStart?.({ prompt: "Add pagination with tests" }, {
      model: undefined,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
    });
    await agentEnd?.(
      {},
      {
        hasUI: false,
        ui: { notify, setStatus: vi.fn() },
      },
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Spec failed:"),
      "warning",
    );
  });
});
