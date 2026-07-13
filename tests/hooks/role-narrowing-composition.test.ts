import { describe, expect, it, vi } from "vitest";
import { makeBeforeToolHandler } from "../../src/hooks/before-tool";
import { PermissionManager } from "../../src/permissions/manager";
import { SpecEngine } from "../../src/spec/engine";
import { roleNarrowingOverlay } from "../../src/governance/role-overlay";
import type { HarnessPolicy } from "../../src/policy/types";

/**
 * Reconstructs the exact composition the `pi.on("tool_call")` gate builds for
 * a live subagent child: the role-narrowing overlay PREPENDED onto the base
 * policy, exactly like the delivery overlay (see
 * tests/hooks/subagent-delivery-composition.test.ts, the sibling test this
 * mirrors). Proves the narrowing rule wins over both a broad ceiling allow
 * and unattended autonomy's "trust the ceiling" bypass.
 */

const basePolicy: HarnessPolicy = {
  version: 1,
  preset: "personal",
  rules: [],
  audit: { enabled: true },
  headless: { defaultDecision: "allow" },
};

function makePermissions() {
  const permissions = new PermissionManager();
  permissions.setYolo(false);
  return permissions;
}

const promptThatThrows = async (): Promise<boolean> => {
  throw new Error("promptUser must NOT be called for a headless subagent");
};

function composeGatePolicy(role: string | undefined): HarnessPolicy {
  const overlay = roleNarrowingOverlay(role);
  return { ...basePolicy, rules: [...overlay, ...basePolicy.rules] };
}

describe("role-narrowing composition (unattended live subagent)", () => {
  it("denies edit for a read-only role's child, naming the narrowing rule's reason", async () => {
    const auditLogger = { record: vi.fn(async () => undefined) };
    const handler = makeBeforeToolHandler(
      makePermissions(),
      new SpecEngine(),
      promptThatThrows,
      false,
      undefined,
      composeGatePolicy("explore"),
      auditLogger as never,
      { sessionId: "child-1", agentType: "subagent" },
      "unattended",
    );

    const result = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("role-deny-edit");
    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "deny", ruleId: "role-deny-edit" }),
    );
  });

  it("denies exec for a read-only role's child — deny wins over unattended", async () => {
    const handler = makeBeforeToolHandler(
      makePermissions(),
      new SpecEngine(),
      promptThatThrows,
      false,
      undefined,
      composeGatePolicy("reviewer"),
      undefined,
      { sessionId: "child-1", agentType: "subagent" },
      "unattended",
    );

    const result = await handler({ toolName: "bash", input: { command: "ls -la" } });

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("role-deny-exec");
  });

  it("evaluator: exec is allowed per the ceiling, edit is denied", async () => {
    const handler = makeBeforeToolHandler(
      makePermissions(),
      new SpecEngine(),
      promptThatThrows,
      false,
      undefined,
      composeGatePolicy("evaluator"),
      undefined,
      { sessionId: "child-1", agentType: "subagent" },
      "unattended",
    );

    const execResult = await handler({ toolName: "bash", input: { command: "npm test" } });
    expect(execResult).toBeUndefined(); // critical tier, but unattended trusts the ceiling — no rule denies exec

    const editResult = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });
    expect(editResult?.block).toBe(true);
    expect(editResult?.reason).toContain("role-deny-edit");
  });

  it("designer: edit is allowed per the ceiling, exec is denied", async () => {
    const handler = makeBeforeToolHandler(
      makePermissions(),
      new SpecEngine(),
      promptThatThrows,
      false,
      undefined,
      composeGatePolicy("designer"),
      undefined,
      { sessionId: "child-1", agentType: "subagent" },
      "unattended",
    );

    const editResult = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });
    expect(editResult).toBeUndefined();

    const execResult = await handler({ toolName: "bash", input: { command: "rm -rf tmp" } });
    expect(execResult?.block).toBe(true);
    expect(execResult?.reason).toContain("role-deny-exec");
  });

  it("writer role (build): no narrowing — both edit and exec follow the ceiling", async () => {
    const handler = makeBeforeToolHandler(
      makePermissions(),
      new SpecEngine(),
      promptThatThrows,
      false,
      undefined,
      composeGatePolicy("build"),
      undefined,
      { sessionId: "child-1", agentType: "subagent" },
      "unattended",
    );

    const editResult = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });
    expect(editResult).toBeUndefined();

    const execResult = await handler({ toolName: "bash", input: { command: "npm test" } });
    expect(execResult).toBeUndefined();
  });

  it("undefined role (parent session): no narrowing", async () => {
    const handler = makeBeforeToolHandler(
      makePermissions(),
      new SpecEngine(),
      promptThatThrows,
      false,
      undefined,
      composeGatePolicy(undefined),
      undefined,
      { sessionId: "parent", agentType: "parent" },
      "unattended",
    );

    const editResult = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });
    expect(editResult).toBeUndefined();
  });
});
