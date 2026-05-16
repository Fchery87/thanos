import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import register from "../src/index";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

type Handler = (...args: unknown[]) => unknown;
type RegisterApi = Parameters<typeof register>[0];

function createFakePi(overrides?: Partial<RegisterApi>) {
  const handlers = new Map<string, Handler>();
  const api = {
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => false),
    on: vi.fn((name: string, handler: Handler) => {
      handlers.set(name, handler);
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    ...overrides,
  };
  return { api: api as unknown as RegisterApi, handlers };
}

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

    const { api, handlers } = createFakePi();
    register(api);

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

  it("blocks governed tool calls when the policy file is invalid", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "harness-index-invalid-policy-"));
    await writeFile(join(cwd, "harness.policy.json"), "{ not json", "utf-8");
    process.chdir(cwd);

    const { api, handlers } = createFakePi();
    register(api);

    const toolCall = handlers.get("tool_call");
    expect(toolCall).toBeTypeOf("function");

    const result = await toolCall?.(
      { toolName: "read", input: { file_path: "README.md" } },
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
      reason: expect.stringContaining("Policy configuration error"),
    });
  });

  it("formats explicit spec approval with scope and evidence", async () => {
    const confirm = vi.fn(async () => true);
    const { api, handlers } = createFakePi({
      getFlag: vi.fn(() => true),
    });
    register(api);

    const beforeAgentStart = handlers.get("before_agent_start");
    const toolCall = handlers.get("tool_call");

    await beforeAgentStart?.({ prompt: "Refactor the auth module" }, {
      model: undefined,
      ui: { setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() },
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
    const notify = vi.fn();
    const { api, handlers } = createFakePi();
    register(api);

    const beforeAgentStart = handlers.get("before_agent_start");
    const agentEnd = handlers.get("agent_end");

    await beforeAgentStart?.({ prompt: "Add pagination with tests" }, {
      model: undefined,
      ui: { setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() },
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

  it("uses the final assistant message as manual completion evidence", async () => {
    const notify = vi.fn();
    const { api, handlers } = createFakePi();
    register(api);

    const beforeAgentStart = handlers.get("before_agent_start");
    const agentEnd = handlers.get("agent_end");

    await beforeAgentStart?.({ prompt: "Confirm the latest HEAD passes all checks" }, {
      model: undefined,
      ui: { setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() },
    });
    await agentEnd?.(
      {
        messages: [
          { role: "assistant", content: [{ type: "text", text: "Done: latest HEAD passes all checks." }] },
        ],
      },
      {
        hasUI: true,
        ui: { notify, setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text, bold: (text: string) => text } },
      },
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Spec: 1/1 passed"),
      "info",
    );
  });
});
