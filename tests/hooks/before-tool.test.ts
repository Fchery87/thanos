import { describe, expect, it, vi } from "vitest";
import { makeBeforeToolHandler } from "../../src/hooks/before-tool";
import { evaluateGovernedToolCall } from "../../src/governance/tool-call";
import { PermissionManager } from "../../src/permissions/manager";
import { SpecEngine } from "../../src/spec/engine";
import type { HarnessPolicy } from "../../src/policy/types";

const basePolicy: HarnessPolicy = {
  version: 1,
  preset: "personal",
  rules: [],
  audit: { enabled: true },
  headless: { defaultDecision: "allow" },
};

function makePermissions(initialYolo = true) {
  const permissions = new PermissionManager();
  permissions.setYolo(initialYolo);
  return permissions;
}
function makeSpec() { return new SpecEngine(); }

describe("makeBeforeToolHandler audit context", () => {
  it("uses the provided sessionId in audit records instead of 'unknown'", async () => {
    const auditLogger = { record: vi.fn(async () => undefined) };
    const handler = makeBeforeToolHandler(
      makePermissions(),
      makeSpec(),
      async () => true,
      true,
      undefined,
      basePolicy,
      auditLogger as never,
      { sessionId: "test-session-abc", agentType: "parent" },
    );

    await handler({ toolName: "read", input: { file_path: "src/index.ts" } });

    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "test-session-abc" }),
    );
  });

  it("uses provided agentType in audit records", async () => {
    const auditLogger = { record: vi.fn(async () => undefined) };
    const handler = makeBeforeToolHandler(
      makePermissions(),
      makeSpec(),
      async () => true,
      true,
      undefined,
      basePolicy,
      auditLogger as never,
      { sessionId: "s1", agentType: "subagent" },
    );

    await handler({ toolName: "read", input: { file_path: "src/index.ts" } });

    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: "subagent" }),
    );
  });
});

describe("precomputed governed decision threading", () => {
  it("honors a governed decision computed by the caller (no recompute)", async () => {
    const denyPolicy: HarnessPolicy = {
      ...basePolicy,
      rules: [
        { id: "deny-deploys", capability: "exec", pattern: "**/deploy*", decision: "deny", reason: "no deploys" },
      ],
    };
    // Handler factory receives NO policy — the deny can only come from the
    // precomputed decision passed per call.
    const handler = makeBeforeToolHandler(
      makePermissions(false),
      makeSpec(),
      async () => true,
      true,
    );

    const event = { toolName: "bash", input: { command: "./deploy.sh prod" } };
    const governed = evaluateGovernedToolCall(event.toolName, event.input, denyPolicy);
    const result = await handler(event, governed);

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("deny-deploys");
  });
});

describe("unrecognized tools (e.g. MCP servers) — high risk tier gate", () => {
  it("attended: prompts for confirmation before an unrecognized tool runs", async () => {
    const promptUser = vi.fn(async () => true);
    const handler = makeBeforeToolHandler(
      makePermissions(false),
      makeSpec(),
      promptUser,
      true, // has UI
      undefined,
      basePolicy,
      undefined,
      { sessionId: "s1", agentType: "parent" },
      "attended",
    );

    const result = await handler({ toolName: "mcp__some-server__deploy", input: {} });

    expect(result).toBeUndefined();
    expect(promptUser).toHaveBeenCalledTimes(1);
  });

  it("headless: denies an unrecognized tool instead of running it silently", async () => {
    const handler = makeBeforeToolHandler(
      makePermissions(false),
      makeSpec(),
      async () => true,
      false, // no UI — headless
      undefined,
      basePolicy,
      undefined,
      { sessionId: "s1", agentType: "parent" },
      "attended",
    );

    const result = await handler({ toolName: "mcp__some-server__deploy", input: {} });

    expect(result?.block).toBe(true);
  });

  it("does NOT extend the policy-allow bypass to an already-recognized high-risk tool", async () => {
    // A known tool (edit) keeps its existing prompt-then-remember behavior even
    // when a policy rule allows it — the bypass in this ticket is specifically
    // the unrecognized-tool escape hatch, not a general "policy allow skips
    // every prompt" feature.
    const promptUser = vi.fn(async () => true);
    const allowEditPolicy: HarnessPolicy = {
      ...basePolicy,
      rules: [{ id: "allow-all-edits", capability: "edit", pattern: "**", decision: "allow", reason: "test" }],
    };
    const handler = makeBeforeToolHandler(
      makePermissions(false),
      makeSpec(),
      promptUser,
      true,
      undefined,
      allowEditPolicy,
      undefined,
      { sessionId: "s1", agentType: "parent" },
      "attended",
    );

    const result = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });

    expect(result).toBeUndefined();
    expect(promptUser).toHaveBeenCalledTimes(1);
  });

  it("an explicit policy allow rule permits the call without a prompt", async () => {
    const promptThatThrows = async (): Promise<boolean> => {
      throw new Error("promptUser must NOT be called when policy explicitly allows the call");
    };
    const trustingPolicy: HarnessPolicy = {
      ...basePolicy,
      rules: [{ id: "trust-deploy-mcp", capability: "exec", pattern: "mcp__some-server__deploy", decision: "allow", reason: "vetted integration" }],
    };
    const handler = makeBeforeToolHandler(
      makePermissions(false),
      makeSpec(),
      promptThatThrows,
      true,
      undefined,
      trustingPolicy,
      undefined,
      { sessionId: "s1", agentType: "parent" },
      "attended",
    );

    const result = await handler({ toolName: "mcp__some-server__deploy", input: {} });

    expect(result).toBeUndefined();
  });
});

describe("headless audit record correctness", () => {
  it("records 'deny' in audit when headless gate blocks — not the defaultDecision config value", async () => {
    const auditLogger = { record: vi.fn(async () => undefined) };
    const policyWithAllowDefault: HarnessPolicy = {
      ...basePolicy,
      headless: { defaultDecision: "allow" },
    };
    const handler = makeBeforeToolHandler(
      makePermissions(false),
      makeSpec(),
      async () => true,
      false, // no UI — headless
      undefined,
      policyWithAllowDefault,
      auditLogger as never,
      { sessionId: "s1", agentType: "parent" },
    );

    // mutating bash is critical-tier, requires confirmation — should block in headless
    const result = await handler({ toolName: "bash", input: { command: "rm -rf tmp" } });

    expect(result?.block).toBe(true);
    // Audit must record the actual decision ("deny"), not the config value ("allow")
    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "deny" }),
    );
  });
});
