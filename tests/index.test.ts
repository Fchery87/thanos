import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "../src/index";
import { noopTheme } from "../src/ui-utils";

// ── Semantic contract stub ────────────────────────────────────────────────
// Since Phase 0 the continuation gate only acts on criteria the extractor
// derived from the user's actual request; a deterministic keyword template is
// reported but never re-injected. So the gate tests below have to drive a real
// semantic contract, which means standing in for the one model call the
// extractor makes. The stub fires ONLY for GATE_PROMPT — every other test in
// this file passes `model: undefined`, so its extractor resolves no model,
// returns undefined, and keeps the deterministic path it was written against.
const GATE_PROMPT = "Add pagination with tests";

const SEMANTIC_STATEMENT = "Pagination is implemented in the listing module";

const SEMANTIC_CONTRACT = {
  objective: GATE_PROMPT,
  criteria: [{
    id: "pagination-1",
    kind: "build",
    statement: SEMANTIC_STATEMENT,
    // A path this repo does not have, so no incidental working-tree diff can
    // satisfy the criterion and accidentally close the gate under test.
    targets: ["src/listing"],
    evidence: ["diff"],
    expectedExecutables: [],
    expectedArgs: [],
    mustNot: [],
    source: "semantic_extraction",
  }],
};

vi.mock("@earendil-works/pi-ai/compat", () => ({
  completeSimple: vi.fn(async (_model: unknown, request: { messages?: Array<{ content?: Array<{ text?: string }> }> }) => {
    const text = request.messages?.[0]?.content?.[0]?.text ?? "";
    if (!text.includes(GATE_PROMPT)) return { stopReason: "error", content: [] };
    return { stopReason: "stop", content: [{ type: "text", text: JSON.stringify(SEMANTIC_CONTRACT) }] };
  }),
}));

/** A ctx the ContractExtractor can actually resolve a model and auth from. */
function extractorCtx(ui: Record<string, unknown>) {
  return {
    model: { provider: "test", id: "test-model" },
    modelRegistry: {
      getAll: () => [],
      hasConfiguredAuth: () => false,
      getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test-key" }),
    },
    ui,
  };
}

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

/**
 * Run a test somewhere that is not the repo.
 *
 * `register()` reads and writes cwd-relative state: it loads harness.policy.json,
 * shells git for diff evidence, and appends to
 * `${cwd}/.harness/evolution/events.jsonl`. Run from the repo root, this suite
 * files synthetic gate failures and extraction outcomes into the developer's own
 * ledger — the same ledger that is the evidence base for the
 * harness-simplification plan. Fifteen such rows were written and removed before
 * this was made blanket rather than per-test.
 */
async function inScratchRepo(prefix: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  process.chdir(cwd);
  return cwd;
}

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
    sendUserMessage: vi.fn(async () => undefined),
    getThinkingLevel: vi.fn(() => "off"),
    ...overrides,
  };
  return { api: api as unknown as RegisterApi, handlers };
}

describe("register", () => {
  // Every test here calls register(), which touches cwd-relative state. None of
  // them should touch the real repo's.
  beforeEach(async () => {
    await inScratchRepo("harness-register-");
  });

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
    register(api, { initialYolo: false });

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
    register(api, { initialYolo: false });

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

  it("folds Pi's base system prompt into the returned systemPrompt", async () => {
    const { api, handlers } = createFakePi();
    register(api, { initialYolo: false });

    const beforeAgentStart = handlers.get("before_agent_start");
    const result = await beforeAgentStart?.(
      { prompt: "Add pagination with tests", systemPrompt: "BASE-SENTINEL" },
      {
        model: undefined,
        ui: { setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() },
      },
    );

    expect(result).toMatchObject({
      systemPrompt: expect.stringContaining("BASE-SENTINEL"),
    });
  });

  it("uses failure-grade verification messaging in headless runs", async () => {
    const notify = vi.fn();
    const { api, handlers } = createFakePi();
    register(api);

    const beforeAgentStart = handlers.get("before_agent_start");
    const agentEnd = handlers.get("agent_end");

    await beforeAgentStart?.(
      { prompt: GATE_PROMPT },
      extractorCtx({ setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() }),
    );
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

  it("does not reset the active spec for a verification continuation turn", async () => {
    const notify = vi.fn();
    const { api, handlers } = createFakePi();
    register(api);

    await handlers.get("before_agent_start")?.(
      { prompt: GATE_PROMPT },
      extractorCtx({ setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() }),
    );
    await handlers.get("agent_end")?.(
      { messages: [] },
      {
        hasUI: true,
        ui: {
          notify,
          setStatus: vi.fn(),
          theme: noopTheme,
        },
      },
    );

    const continuation = (api.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string | undefined;
    expect(continuation).toContain("[harness:verify-continue]");

    await handlers.get("before_agent_start")?.(
      { prompt: continuation ?? "" },
      extractorCtx({ setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() }),
    );

    expect(notify).toHaveBeenCalledWith(expect.stringContaining(SEMANTIC_STATEMENT), "warning");
  });

  it("re-injects a follow-up when verification fails and the gate is enabled", async () => {
    const sendUserMessage = vi.fn(async () => undefined);
    const { api, handlers } = createFakePi({ sendUserMessage } as Partial<RegisterApi>);
    register(api);

    await handlers.get("before_agent_start")?.(
      { prompt: GATE_PROMPT },
      extractorCtx({ setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() }),
    );
    await handlers.get("agent_end")?.(
      { messages: [] },
      {
        hasUI: true,
        ui: { notify: vi.fn(), setStatus: vi.fn(), theme: noopTheme },
      },
    );

    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("[harness:verify-continue]"),
      { deliverAs: "followUp" },
    );
  });

  // The other half of Phase 0, and the reason the gate was costing a turn a
  // day: the same prompt with only the deterministic keyword contract behind it
  // must NOT re-inject. (No model on the ctx → no extraction → template only.)
  it("does not re-inject when only the deterministic template contract is unmet", async () => {
    const sendUserMessage = vi.fn(async () => undefined);
    const { api, handlers } = createFakePi({ sendUserMessage } as Partial<RegisterApi>);
    register(api);

    await handlers.get("before_agent_start")?.({ prompt: GATE_PROMPT }, {
      model: undefined,
      ui: { setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() },
    });
    await handlers.get("agent_end")?.(
      { messages: [] },
      {
        hasUI: true,
        ui: { notify: vi.fn(), setStatus: vi.fn(), theme: noopTheme },
      },
    );

    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("records a harness ledger event when the verification gate re-injects", async () => {
    const cwd = await inScratchRepo("harness-ledger-");
    const sendUserMessage = vi.fn(async () => undefined);
    const { api, handlers } = createFakePi({ sendUserMessage } as Partial<RegisterApi>);
    register(api);

    await handlers.get("before_agent_start")?.(
      { prompt: GATE_PROMPT },
      extractorCtx({ setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() }),
    );
    await handlers.get("agent_end")?.(
      { messages: [] },
      {
        hasUI: true,
        model: { id: "model-id", name: "Model Name" },
        ui: { notify: vi.fn(), setStatus: vi.fn(), theme: noopTheme },
      },
    );

    const raw = await readFile(join(cwd, ".harness", "evolution", "events.jsonl"), "utf-8");
    // JSONL, and since Phase 2 this turn writes two rows: the spec_extraction
    // outcome and then the gate_failure. Parse it as the line-delimited format
    // it is rather than assuming a single object.
    const events = raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

    const gateFailure = events.find((entry) => entry.type === "gate_failure");
    expect(gateFailure).toMatchObject({
      type: "gate_failure",
      model: "model-id",
      outcome: "needs_work",
    });
    expect(gateFailure.summary).toContain("verification gate re-injected");

    // The extraction outcome is recorded on the same turn — this is what made
    // the 0-for-48 invisible for as long as it was.
    expect(events.find((entry) => entry.type === "spec_extraction")).toMatchObject({
      summary: "semantic extraction: accepted",
      outcome: "ok",
    });

    // Neither row may carry the user's prompt.
    expect(raw).not.toContain(GATE_PROMPT);
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

    // Simulate a tool_result that creates evidence
    const toolResult = handlers.get("tool_result");
    await toolResult?.({
      toolName: "bash",
      input: { command: "vitest run" },
      content: [{ type: "text", text: "3 pass" }],
      isError: false,
    }, {
      hasUI: true,
      ui: { notify: vi.fn(), setStatus: vi.fn(), theme: { fg: (_k: string, t: string) => t } },
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
      expect.stringContaining("Spec:"),
      expect.any(String),
    );
  });

  it("review shortcut executes the heterogeneous jury graph", async () => {
    const sendUserMessage = vi.fn(async () => undefined);
    const notify = vi.fn();
    const requests: Array<Record<string, unknown>> = [];
    const busHandlers = new Map<string, Set<(value: unknown) => void>>();
    const events = {
      on: (name: string, handler: (value: unknown) => void) => {
        const set = busHandlers.get(name) ?? new Set();
        set.add(handler);
        busHandlers.set(name, set);
        return () => set.delete(handler);
      },
      emit: (name: string, value: unknown) => {
        if (name !== "prompt-template:subagent:request") {
          for (const handler of busHandlers.get(name) ?? []) handler(value);
          return;
        }
        const request = value as Record<string, unknown>;
        requests.push(request);
        queueMicrotask(() => {
          const response = {
            requestId: request.requestId,
            ownerRunId: request.ownerRunId,
            nodeId: request.nodeId,
            runId: `run-${String(request.nodeId)}`,
            status: "completed",
            launchContractDigest: "a".repeat(64),
            execution: { status: "completed", success: true, exitCode: 0 },
            acceptance: { status: "accepted", evidenceStatus: "verified", explicit: true },
            review: { status: "reviewed", findings: [] },
            effects: {},
            artifacts: [],
            warnings: [],
            residualRisks: [],
            result: { kind: "text", text: `${String(request.nodeId)} complete` },
          };
          for (const handler of busHandlers.get("prompt-template:subagent:response") ?? []) handler(response);
        });
      },
    };
    const { api } = createFakePi({ sendUserMessage, events } as Partial<RegisterApi>);
    register(api);

    const registerShortcut = api.registerShortcut as ReturnType<typeof vi.fn>;
    const reviewShortcut = registerShortcut.mock.calls.find(
      ([shortcut]: [string]) => shortcut === "ctrl+shift+r",
    )?.[1];

    expect(reviewShortcut?.handler).toBeTypeOf("function");
    await reviewShortcut?.handler({
      hasUI: true,
      ui: { notify, setStatus: vi.fn(), theme: noopTheme },
      cwd: process.cwd(),
      sessionManager: {
        getSessionFile: () => "/tmp/session.jsonl",
        getSessionId: () => "session-1",
      },
    });

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(requests.map((request) => request.agent).sort()).toEqual([
      "oracle",
      "reviewer-correctness",
      "reviewer-security",
      "reviewer-tests",
    ]);
    expect(notify).toHaveBeenLastCalledWith("oracle complete", "info");
  });

  it("review shortcut is unavailable in subagent sessions", async () => {
    const originalChild = process.env.PI_SUBAGENT_CHILD;
    const originalChildAgent = process.env.PI_SUBAGENT_CHILD_AGENT;
    process.env.PI_SUBAGENT_CHILD = "1";
    process.env.PI_SUBAGENT_CHILD_AGENT = "reviewer";
    const sendUserMessage = vi.fn(async () => undefined);
    const notify = vi.fn();
    const { api } = createFakePi({ sendUserMessage } as Partial<RegisterApi>);
    register(api);
    if (originalChild === undefined) {
      delete process.env.PI_SUBAGENT_CHILD;
    } else {
      process.env.PI_SUBAGENT_CHILD = originalChild;
    }
    if (originalChildAgent === undefined) {
      delete process.env.PI_SUBAGENT_CHILD_AGENT;
    } else {
      process.env.PI_SUBAGENT_CHILD_AGENT = originalChildAgent;
    }

    const registerShortcut = api.registerShortcut as ReturnType<typeof vi.fn>;
    const reviewShortcut = registerShortcut.mock.calls.find(
      ([shortcut]: [string]) => shortcut === "ctrl+shift+r",
    )?.[1];

    await reviewShortcut?.handler({
      hasUI: true,
      ui: { notify, setStatus: vi.fn(), theme: noopTheme },
    });

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Code review is only available in the main session.", "warning");
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
        sessionManager: { getSessionDir: () => join(cwd, "sessions"), getBranch: () => [] },
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
    // report_finding is only registered for subagent sessions
    const originalChild = process.env.PI_SUBAGENT_CHILD;
    const originalChildAgent = process.env.PI_SUBAGENT_CHILD_AGENT;
    process.env.PI_SUBAGENT_CHILD = "1";
    process.env.PI_SUBAGENT_CHILD_AGENT = "reviewer";
    const { api, handlers } = createFakePi();
    register(api);
    if (originalChild === undefined) {
      delete process.env.PI_SUBAGENT_CHILD;
    } else {
      process.env.PI_SUBAGENT_CHILD = originalChild;
    }
    if (originalChildAgent === undefined) {
      delete process.env.PI_SUBAGENT_CHILD_AGENT;
    } else {
      process.env.PI_SUBAGENT_CHILD_AGENT = originalChildAgent;
    }

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
        sessionManager: { getSessionDir: () => join(process.cwd(), "sessions"), getBranch: () => [] },
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
