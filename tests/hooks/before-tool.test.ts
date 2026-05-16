import { describe, expect, it, vi } from "vitest";
import { makeBeforeToolHandler } from "../../src/hooks/before-tool";
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

function makePermissions() { return new PermissionManager(); }
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

describe("headless audit record correctness", () => {
  it("records 'deny' in audit when headless gate blocks — not the defaultDecision config value", async () => {
    const auditLogger = { record: vi.fn(async () => undefined) };
    const policyWithAllowDefault: HarnessPolicy = {
      ...basePolicy,
      headless: { defaultDecision: "allow" },
    };
    const handler = makeBeforeToolHandler(
      makePermissions(),
      makeSpec(),
      async () => true,
      false, // no UI — headless
      undefined,
      policyWithAllowDefault,
      auditLogger as never,
      { sessionId: "s1", agentType: "parent" },
    );

    // bash is critical-tier, requires confirmation — should block in headless
    const result = await handler({ toolName: "bash", input: { command: "ls" } });

    expect(result?.block).toBe(true);
    // Audit must record the actual decision ("deny"), not the config value ("allow")
    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "deny" }),
    );
  });
});
