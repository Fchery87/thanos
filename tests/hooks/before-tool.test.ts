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
