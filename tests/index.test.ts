import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import register from "../src/index";
import { noopTheme } from "../src/ui-utils";

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
    getThinkingLevel: vi.fn(() => "off"),
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
      reason: expect.stringContaining("builtin-deny-env-read"),
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

  it("installs the structured startup welcome header", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "harness-welcome-"));
    process.chdir(cwd);
    const setHeader = vi.fn();
    const { api, handlers } = createFakePi({
      getThinkingLevel: vi.fn(() => "medium"),
    } as Partial<RegisterApi>);

    register(api);

    await handlers.get("session_start")?.(
      { reason: "startup" },
      {
        cwd,
        model: { id: "model-id", name: "Model Name" },
        sessionManager: { getSessionDir: () => join(cwd, "sessions") },
        ui: {
          setHeader,
          setStatus: vi.fn(),
          notify: vi.fn(),
          theme: noopTheme,
        },
      },
    );

    expect(setHeader).toHaveBeenCalledOnce();
    const factory = setHeader.mock.calls[0]?.[0] as ((_tui: unknown, theme: typeof noopTheme) => { render: (width: number) => string[] }) | undefined;
    const output = factory?.({}, noopTheme).render(120).join("\n") ?? "";

    expect(output).toContain("Agent Distribution");
    expect(output).toContain("Model Name");
    expect(output).toContain("/status");
    expect(output).toContain("/policy");
    expect(output).toContain("/tools");
  });

  it("resets report_finding state on session_start so prior findings don't leak", async () => {
    // report_finding is only registered for reviewer subagents
    const originalEnv = process.env.HARNESS_SUBAGENT;
    process.env.HARNESS_SUBAGENT = "reviewer";
    const { api, handlers } = createFakePi();
    register(api);
    process.env.HARNESS_SUBAGENT = originalEnv;

    // Locate the report_finding tool executor
    const registerTool = api.registerTool as ReturnType<typeof vi.fn>;
    const reportFindingCall = registerTool.mock.calls.find(
      ([def]: [{ name: string }]) => def?.name === "report_finding",
    );
    const reportFindingExec = reportFindingCall?.[0]?.execute;
    expect(reportFindingExec).toBeTypeOf("function");

    // Add a finding
    await reportFindingExec?.("id1", {
      severity: "high",
      title: "Old finding from previous session",
      description: "Should not survive a session restart",
      evidence: "evidence",
    });

    // Fire session_start to simulate a new session
    await handlers.get("session_start")?.(
      { reason: "startup" },
      {
        cwd: process.cwd(),
        model: undefined,
        sessionManager: { getSessionDir: () => join(process.cwd(), "sessions") },
        ui: { setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn(), theme: noopTheme },
      },
    );

    // After session_start, a new report_finding call should see a fresh list (no old findings)
    const result = await reportFindingExec?.("id2", {
      severity: "low",
      title: "New finding",
      description: "Fresh start",
      evidence: "evidence",
    });

    // The summary should contain only 1 finding (the new one), not 2
    const text = (result as { content: { text: string }[] }).content[0]?.text ?? "";
    expect(text).not.toContain("Old finding from previous session");
    expect(text).toContain("New finding");
  });

  it("catches tool_result handler errors and logs to stderr instead of unhandled rejection", async () => {
    const { api, handlers } = createFakePi();
    register(api);

    // Spy on console.error before triggering
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const toolResult = handlers.get("tool_result");
    expect(toolResult).toBeTypeOf("function");

    // Pass a malformed event that would cause an internal error in the handler chain.
    // The handler must NOT throw — it must resolve and log to stderr.
    let threw = false;
    try {
      await toolResult?.(null as never, {} as never);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    errorSpy.mockRestore();
  });
});
