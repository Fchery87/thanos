import { describe, expect, it } from "vitest";
import {
  buildToolContractSnapshot,
  HARNESS_TOOL_NAMES,
  type ToolContractToolInfo,
} from "../../src/governance/tool-contract";
import { capabilityForTool, evaluateGovernedToolCall } from "../../src/governance/tool-call";
import { classifyRisk, isRecognizedTool } from "../../src/permissions/risk";

function tool(name: string, overrides: Partial<ToolContractToolInfo> = {}): ToolContractToolInfo {
  return { name, description: `${name} description`, parameters: { type: "object" }, ...overrides };
}

// The full builtin + harness + delegation surface a real session registers,
// mirroring register-harness.smoke.test.ts's PARENT_COMMANDS-style inventory.
const BUILTIN_TOOLS = ["read", "ls", "find", "grep", "write", "edit", "bash"];
const HARNESS_TOOLS = [...HARNESS_TOOL_NAMES];
const FULL_PARENT_SURFACE = [...BUILTIN_TOOLS, ...HARNESS_TOOLS.filter((n) => n !== "report_finding"), "subagent"];

describe("buildToolContractSnapshot", () => {
  it("projects every registered harness tool as recognized, with non-empty description and schema", () => {
    const snapshot = buildToolContractSnapshot({
      tools: FULL_PARENT_SURFACE.map((name) => tool(name)),
      activeToolNames: FULL_PARENT_SURFACE,
    });

    for (const name of HARNESS_TOOL_NAMES) {
      if (name === "report_finding") continue; // not in the parent surface fixture
      const entry = snapshot.entries.find((e) => e.name === name);
      expect(entry, `missing contract entry for ${name}`).toBeDefined();
      expect(entry?.recognized).toBe(true);
      expect(entry?.source).toBe("harness");
      expect(entry?.description.length).toBeGreaterThan(0);
      expect(entry?.schema).toBeDefined();
      expect(entry?.documentation).toBe("generated");
    }
  });

  it("classifies workflow_yield as a recognized, medium-risk, task-capability tool", () => {
    // Regression coverage: workflow_yield used to fall through the unknown
    // path in both risk.ts and tool-call.ts (fixed alongside this module).
    const snapshot = buildToolContractSnapshot({ tools: [tool("workflow_yield")], activeToolNames: ["workflow_yield"] });
    const entry = snapshot.entries[0];
    expect(entry?.recognized).toBe(true);
    expect(entry?.capability).toBe("task");
    expect(entry?.risk).toBe("medium");
  });

  it("keeps unique names and a stable, deterministic order regardless of input order", () => {
    const forward = buildToolContractSnapshot({
      tools: FULL_PARENT_SURFACE.map((name) => tool(name)),
      activeToolNames: FULL_PARENT_SURFACE,
    });
    const reversed = buildToolContractSnapshot({
      tools: [...FULL_PARENT_SURFACE].reverse().map((name) => tool(name)),
      activeToolNames: FULL_PARENT_SURFACE,
    });

    expect(forward.entries.map((e) => e.name)).toEqual(reversed.entries.map((e) => e.name));
    const names = forward.entries.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
  });

  it("drops a duplicate registration of the same tool name instead of double-counting it", () => {
    const snapshot = buildToolContractSnapshot({
      tools: [tool("read"), tool("read")],
      activeToolNames: ["read"],
    });
    expect(snapshot.entries.filter((e) => e.name === "read")).toHaveLength(1);
  });

  it("marks builtin tools as builtin/not-applicable documentation, not harness-owned", () => {
    const snapshot = buildToolContractSnapshot({ tools: BUILTIN_TOOLS.map((name) => tool(name)), activeToolNames: BUILTIN_TOOLS });
    for (const entry of snapshot.entries) {
      expect(entry.source).toBe("builtin");
      expect(entry.documentation).toBe("not-applicable");
    }
  });

  it("classifies the pi-subagents `subagent` tool distinctly from builtin/harness", () => {
    const snapshot = buildToolContractSnapshot({ tools: [tool("subagent")], activeToolNames: ["subagent"] });
    expect(snapshot.entries[0]?.source).toBe("pi-subagents");
    expect(snapshot.entries[0]?.recognized).toBe(true);
  });

  it("treats an unknown/MCP tool conservatively: unrecognized, high risk, mcp source when labeled", () => {
    const snapshot = buildToolContractSnapshot({
      tools: [tool("acme_deploy", { sourceInfo: { source: "mcp:acme-server" } })],
      activeToolNames: ["acme_deploy"],
    });
    const entry = snapshot.entries[0];
    expect(entry?.recognized).toBe(false);
    expect(entry?.risk).toBe("high");
    expect(entry?.source).toBe("mcp");
    expect(entry?.documentation).toBe("not-applicable");
  });

  it("falls back to builtin source for an unrecognized tool with no MCP label, never claiming harness ownership", () => {
    const snapshot = buildToolContractSnapshot({ tools: [tool("mystery_tool")], activeToolNames: [] });
    expect(snapshot.entries[0]?.source).toBe("builtin");
    expect(snapshot.entries[0]?.recognized).toBe(false);
  });

  it("marks a tool active only when it's in activeToolNames — parent/subagent surfaces differ", () => {
    const parentSnapshot = buildToolContractSnapshot({
      tools: [tool("ask"), tool("report_finding")],
      activeToolNames: ["ask"], // parent session: ask active, report_finding is not
    });
    expect(parentSnapshot.entries.find((e) => e.name === "ask")?.active).toBe(true);
    expect(parentSnapshot.entries.find((e) => e.name === "report_finding")?.active).toBe(false);

    const subagentSnapshot = buildToolContractSnapshot({
      tools: [tool("ask"), tool("report_finding")],
      activeToolNames: ["report_finding"], // subagent session: the reverse
    });
    expect(subagentSnapshot.entries.find((e) => e.name === "ask")?.active).toBe(false);
    expect(subagentSnapshot.entries.find((e) => e.name === "report_finding")?.active).toBe(true);
  });

  it("computes summary counts that match the entries", () => {
    const snapshot = buildToolContractSnapshot({
      tools: [tool("read"), tool("write"), tool("mystery_tool")],
      activeToolNames: ["read", "write"],
    });
    expect(snapshot.summary).toEqual({
      active: 2,
      recognized: 2,
      unknown: 1,
      readOnly: 1,
      mutating: 2,
    });
  });

  it("produces a revision that changes when the projected surface changes, and is stable when it doesn't", () => {
    const a = buildToolContractSnapshot({ tools: [tool("read")], activeToolNames: ["read"] });
    const b = buildToolContractSnapshot({ tools: [tool("read")], activeToolNames: ["read"] });
    const c = buildToolContractSnapshot({ tools: [tool("read"), tool("write")], activeToolNames: ["read"] });
    expect(a.revision).toBe(b.revision);
    expect(a.revision).not.toBe(c.revision);
  });

  it("is read-only: building a snapshot performs no model, network, or filesystem call", () => {
    // Nothing to await, nothing to mock out — buildToolContractSnapshot is a
    // synchronous pure function. This test's only job is to fail loudly if
    // that ever stops being true (e.g. someone makes it async).
    const result = buildToolContractSnapshot({ tools: [tool("read")], activeToolNames: ["read"] });
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("agrees with the live runtime authorization classification for every tool name", () => {
    // The acceptance gate: runtime authorization and this diagnostic
    // projection must classify identical inputs identically.
    const snapshot = buildToolContractSnapshot({
      tools: FULL_PARENT_SURFACE.map((name) => tool(name)),
      activeToolNames: FULL_PARENT_SURFACE,
    });
    for (const name of FULL_PARENT_SURFACE) {
      const runtimeCall = evaluateGovernedToolCall(name, {});
      const entry = snapshot.entries.find((e) => e.name === name);
      expect(entry?.capability, name).toBe(runtimeCall.call.capability);
      expect(entry?.risk, name).toBe(runtimeCall.call.riskTier);
      expect(entry?.recognized, name).toBe(runtimeCall.call.recognized);
      expect(entry?.capability, name).toBe(capabilityForTool(name));
      expect(entry?.risk, name).toBe(classifyRisk(name, {}));
      expect(entry?.recognized, name).toBe(isRecognizedTool(name));
    }
  });
});
