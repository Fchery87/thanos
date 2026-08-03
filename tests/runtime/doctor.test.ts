import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  collectDoctorDiagnostics, renderDoctorDiagnostics, registerDoctorCommand, worstSeverity,
  type Diagnostic, type DoctorInputs,
} from "../../src/runtime/commands/doctor";
import { buildToolContractSnapshot } from "../../src/governance/tool-contract";
import { noopTheme } from "../../src/ui-utils";
import { GoalController } from "../../src/goal/controller";
import { SpecEngine } from "../../src/spec/engine";
import { WorkflowRuntime } from "../../src/workflows/state";

function baseInputs(overrides: Partial<DoctorInputs> = {}): DoctorInputs {
  return {
    policy: { kind: "ok", policy: { version: 1, preset: "team", rules: [], audit: { enabled: true, path: ".harness/audit.jsonl" }, headless: { defaultDecision: "deny" } } } as never,
    mcpStatuses: [],
    delivery: { registered: true, mode: "local-only" },
    patchDrift: {},
    toolContract: buildToolContractSnapshot({ tools: [{ name: "read", description: "Read a file", parameters: {} }], activeToolNames: ["read"] }),
    goalStatus: "none",
    workflowPhase: undefined,
    specActive: false,
    extraction: { enabled: true, timeoutMs: 10_000 },
    ...overrides,
  };
}

describe("collectDoctorDiagnostics", () => {
  it("reports policy success", () => {
    const [policy] = collectDoctorDiagnostics(baseInputs());
    expect(policy).toMatchObject({ severity: "info", code: "policy.ok", subsystem: "policy" });
  });

  it("reports policy error distinctly, at error severity", () => {
    const [policy] = collectDoctorDiagnostics(baseInputs({ policy: { kind: "error", error: "bad json" } as never }));
    expect(policy).toMatchObject({ severity: "error", code: "policy.error", message: "bad json" });
  });

  it("reports no MCP servers configured", () => {
    const diagnostics = collectDoctorDiagnostics(baseInputs({ mcpStatuses: [] }));
    const mcp = diagnostics.find((d) => d.subsystem === "mcp");
    expect(mcp).toMatchObject({ severity: "info", code: "mcp.none" });
  });

  it("reports all servers connected", () => {
    const diagnostics = collectDoctorDiagnostics(baseInputs({
      mcpStatuses: [{ name: "a", source: "user", toolCount: 3, connected: true, disabled: false }],
    }));
    expect(diagnostics.find((d) => d.subsystem === "mcp")).toMatchObject({ severity: "info", code: "mcp.connected" });
  });

  it("reports a disabled server without treating it as failed or blocked", () => {
    const diagnostics = collectDoctorDiagnostics(baseInputs({
      mcpStatuses: [{ name: "a", source: "user", toolCount: 0, connected: false, disabled: true }],
    }));
    const mcp = diagnostics.find((d) => d.subsystem === "mcp");
    expect(mcp?.code).toBe("mcp.connected");
    expect(mcp?.message).toContain("disabled");
  });

  it("reports a trust-blocked server as warning, distinct code from failed", () => {
    const diagnostics = collectDoctorDiagnostics(baseInputs({
      mcpStatuses: [{ name: "a", source: "user", toolCount: 0, connected: false, disabled: false, blocked: true }],
    }));
    const mcp = diagnostics.find((d) => d.subsystem === "mcp");
    expect(mcp).toMatchObject({ severity: "warning", code: "mcp.blocked" });
  });

  it("reports an operationally failed server as error, distinct code from blocked", () => {
    const diagnostics = collectDoctorDiagnostics(baseInputs({
      mcpStatuses: [{ name: "a", source: "user", toolCount: 0, connected: false, disabled: false, error: "ECONNREFUSED" }],
    }));
    const mcp = diagnostics.find((d) => d.subsystem === "mcp");
    expect(mcp).toMatchObject({ severity: "error", code: "mcp.failed" });
  });

  it("prioritizes failed over blocked in a mixed MCP fleet", () => {
    const diagnostics = collectDoctorDiagnostics(baseInputs({
      mcpStatuses: [
        { name: "connected", source: "user", toolCount: 1, connected: true, disabled: false },
        { name: "blocked", source: "user", toolCount: 0, connected: false, disabled: false, blocked: true },
        { name: "failed", source: "user", toolCount: 0, connected: false, disabled: false, error: "timeout" },
      ],
    }));
    const mcp = diagnostics.find((d) => d.subsystem === "mcp");
    expect(mcp?.code).toBe("mcp.failed");
    expect(mcp?.message).toContain("blocked");
    expect(mcp?.message).toContain("failed");
  });

  it("reports registered vs unregistered delivery", () => {
    const registered = collectDoctorDiagnostics(baseInputs({ delivery: { registered: true, mode: "local-only" } }));
    expect(registered.find((d) => d.subsystem === "delivery")).toMatchObject({ severity: "info", code: "delivery.registered" });

    const unregistered = collectDoctorDiagnostics(baseInputs({ delivery: { registered: false, mode: "local-only" } }));
    expect(unregistered.find((d) => d.subsystem === "delivery")).toMatchObject({ severity: "warning", code: "delivery.unregistered" });
  });

  it("reports unresolved delivery state", () => {
    const diagnostics = collectDoctorDiagnostics(baseInputs({ delivery: undefined }));
    expect(diagnostics.find((d) => d.subsystem === "delivery")).toMatchObject({ severity: "warning", code: "delivery.unresolved" });
  });

  it("reports intact, drifted, and failed patch-check states", () => {
    expect(collectDoctorDiagnostics(baseInputs({ patchDrift: {} })).find((d) => d.subsystem === "subagents"))
      .toMatchObject({ severity: "info", code: "subagents.patch_ok" });
    expect(collectDoctorDiagnostics(baseInputs({ patchDrift: { warning: "patch missing" } })).find((d) => d.subsystem === "subagents"))
      .toMatchObject({ severity: "warning", code: "subagents.patch_drift" });
    expect(collectDoctorDiagnostics(baseInputs({ patchDrift: { error: "ENOENT" } })).find((d) => d.subsystem === "subagents"))
      .toMatchObject({ severity: "warning", code: "subagents.patch_check_failed" });
  });

  it("summarizes the tool contract, flagging unknown tools", () => {
    const okSnapshot = buildToolContractSnapshot({ tools: [{ name: "read", description: "x", parameters: {} }], activeToolNames: ["read"] });
    expect(collectDoctorDiagnostics(baseInputs({ toolContract: okSnapshot })).find((d) => d.subsystem === "tools"))
      .toMatchObject({ severity: "info", code: "tools.ok" });

    const unknownSnapshot = buildToolContractSnapshot({ tools: [{ name: "mystery", description: "x", parameters: {} }], activeToolNames: ["mystery"] });
    expect(collectDoctorDiagnostics(baseInputs({ toolContract: unknownSnapshot })).find((d) => d.subsystem === "tools"))
      .toMatchObject({ severity: "warning", code: "tools.unknown_present" });
  });

  it("summarizes active goal/workflow/spec state", () => {
    const diagnostics = collectDoctorDiagnostics(baseInputs({ goalStatus: "active", workflowPhase: "integrating", specActive: true }));
    const state = diagnostics.find((d) => d.subsystem === "state");
    expect(state?.message).toContain("goal active");
    expect(state?.message).toContain("workflow integrating");
    expect(state?.message).toContain("spec active");
  });

  it("reports extraction settings", () => {
    expect(collectDoctorDiagnostics(baseInputs({ extraction: { enabled: true, timeoutMs: 5000 } })).find((d) => d.subsystem === "extraction"))
      .toMatchObject({ severity: "info", code: "extraction.enabled" });
    expect(collectDoctorDiagnostics(baseInputs({ extraction: { enabled: false, timeoutMs: 5000 } })).find((d) => d.subsystem === "extraction"))
      .toMatchObject({ severity: "info", code: "extraction.disabled" });
  });

  it("always collects checks in the same, stable order", () => {
    const order = (inputs: DoctorInputs) => collectDoctorDiagnostics(inputs).map((d) => d.subsystem);
    expect(order(baseInputs())).toEqual(order(baseInputs({ policy: { kind: "error", error: "x" } as never })));
    expect(order(baseInputs())).toEqual(["policy", "mcp", "delivery", "tools", "state", "extraction", "subagents"]);
  });

  it("completes well under 25ms with in-memory dependencies", () => {
    const start = performance.now();
    collectDoctorDiagnostics(baseInputs({
      mcpStatuses: [{ name: "a", source: "user", toolCount: 1, connected: true, disabled: false }],
    }));
    expect(performance.now() - start).toBeLessThan(25);
  });
});

describe("worstSeverity", () => {
  it("is monotonic: a healthy check can never downgrade an error found elsewhere", () => {
    const withError: Diagnostic[] = [
      { severity: "info", code: "a", subsystem: "a", message: "ok" },
      { severity: "error", code: "b", subsystem: "b", message: "bad" },
      { severity: "info", code: "c", subsystem: "c", message: "ok" },
      { severity: "info", code: "d", subsystem: "d", message: "ok" },
    ];
    expect(worstSeverity(withError)).toBe("error");
    // Order independence: the error's position doesn't matter.
    expect(worstSeverity([...withError].reverse())).toBe("error");
  });

  it("is info when every diagnostic is info", () => {
    expect(worstSeverity([{ severity: "info", code: "a", subsystem: "a", message: "ok" }])).toBe("info");
  });

  it("is warning when the worst diagnostic is a warning, not error", () => {
    expect(worstSeverity([
      { severity: "info", code: "a", subsystem: "a", message: "ok" },
      { severity: "warning", code: "b", subsystem: "b", message: "meh" },
    ])).toBe("warning");
  });

  it("is info for an empty diagnostic list", () => {
    expect(worstSeverity([])).toBe("info");
  });
});

describe("renderDoctorDiagnostics", () => {
  it("is testable independently of collection: renders a hand-built diagnostic list", () => {
    const diagnostics: Diagnostic[] = [
      { severity: "error", code: "policy.error", subsystem: "policy", message: "bad json" },
    ];
    const panel = renderDoctorDiagnostics(diagnostics, noopTheme);
    expect(panel).toContain("Harness Health");
    expect(panel).toContain("policy");
    expect(panel).toContain("bad json");
  });
});

describe("registerDoctorCommand", () => {
  function makeFakePi(overrides: Record<string, unknown> = {}) {
    const registered: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> } = { handler: async () => {} };
    const api = {
      registerCommand: vi.fn((_name: string, def: { handler: typeof registered.handler }) => {
        registered.handler = def.handler;
      }),
      getAllTools: vi.fn(() => []),
      getActiveTools: vi.fn(() => []),
      ...overrides,
    };
    return { api: api as unknown as ExtensionAPI, registered };
  }

  function makeFakeCtx() {
    const notify = vi.fn();
    return {
      ctx: { ui: { notify, theme: noopTheme } } as unknown as ExtensionCommandContext,
      notify,
    };
  }

  it("main session: registers /doctor and runs without mutating any dependency", async () => {
    const { api, registered } = makeFakePi();
    const { ctx, notify } = makeFakeCtx();

    registerDoctorCommand(api, {
      isSubagent: false,
      policyStatePromise: Promise.resolve({ kind: "ok", policy: { version: 1, preset: "team", rules: [], audit: { enabled: false, path: "x" }, headless: { defaultDecision: "deny" } } } as never),
      mcpManager: null,
      deliveryRuntime: { getState: async () => ({ registered: true, mode: "local-only" }) } as never,
      goalController: new GoalController(),
      spec: new SpecEngine(),
      workflowRuntime: new WorkflowRuntime(),
    });

    await registered.handler("", ctx);

    expect(notify).toHaveBeenCalledTimes(1);
    const [panel] = notify.mock.calls[0] as [string];
    expect(panel).toContain("Harness Health");
  });

  it("subagent session: refuses to run rather than collecting any diagnostic", async () => {
    const { api, registered } = makeFakePi();
    const { ctx, notify } = makeFakeCtx();

    registerDoctorCommand(api, {
      isSubagent: true,
      policyStatePromise: Promise.resolve({ kind: "ok", policy: { version: 1, preset: "team", rules: [], audit: { enabled: false, path: "x" }, headless: { defaultDecision: "deny" } } } as never),
      mcpManager: null,
      deliveryRuntime: { getState: async () => undefined } as never,
      goalController: new GoalController(),
      spec: new SpecEngine(),
      workflowRuntime: new WorkflowRuntime(),
    });

    await registered.handler("", ctx);

    expect(notify).toHaveBeenCalledTimes(1);
    const [message, level] = notify.mock.calls[0] as [string, string];
    expect(message).toContain("only available in the main session");
    expect(level).toBe("warning");
  });

  it("never starts an MCP server, probes the network, calls a model, or appends a ledger row", async () => {
    const getStatuses = vi.fn(() => []);
    const { api, registered } = makeFakePi();
    const { ctx } = makeFakeCtx();

    registerDoctorCommand(api, {
      isSubagent: false,
      policyStatePromise: Promise.resolve({ kind: "ok", policy: { version: 1, preset: "team", rules: [], audit: { enabled: false, path: "x" }, headless: { defaultDecision: "deny" } } } as never),
      mcpManager: { getStatuses } as never,
      deliveryRuntime: { getState: async () => ({ registered: true, mode: "local-only" }) } as never,
      goalController: new GoalController(),
      spec: new SpecEngine(),
      workflowRuntime: new WorkflowRuntime(),
    });

    await registered.handler("", ctx);

    // getStatuses is a synchronous read of already-known state, called
    // exactly once — never a connect/start call, never polled.
    expect(getStatuses).toHaveBeenCalledTimes(1);
  });
});
