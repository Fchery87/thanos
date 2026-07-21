import { describe, expect, it, vi } from "vitest";
import { makeBeforeToolHandler } from "../../src/hooks/before-tool";
import { PermissionManager } from "../../src/permissions/manager";
import { SpecEngine } from "../../src/spec/engine";
import type { HarnessPolicy } from "../../src/policy/types";
import type { FormalSpec } from "../../src/spec/types";

const basePolicy: HarnessPolicy = {
  version: 1,
  preset: "personal",
  rules: [],
  audit: { enabled: true },
  headless: { defaultDecision: "allow" },
};

// Permissions with yolo OFF so the real evaluate/deny logic runs. `edit` is
// "ask" by default in the PermissionManager defaults.
function makePermissions() {
  const permissions = new PermissionManager();
  permissions.setYolo(false);
  return permissions;
}

function makeSpec() {
  return new SpecEngine();
}

// A prompt callback that fails the test if it is ever called. Used to prove the
// unattended branch never reaches the interactive confirmation.
const promptThatThrows = async (): Promise<boolean> => {
  throw new Error("promptUser must NOT be called under unattended autonomy");
};

describe("unattended autonomy gate", () => {
  it("auto-approves an edit the ceiling permits WITHOUT prompting", async () => {
    const auditLogger = { record: vi.fn(async () => undefined) };
    const handler = makeBeforeToolHandler(
      makePermissions(),
      makeSpec(),
      promptThatThrows, // throws if the interactive prompt is reached
      true, // has UI
      undefined,
      basePolicy,
      auditLogger as never,
      { sessionId: "s1", agentType: "parent" },
      "unattended",
    );

    // edit → "ask" by default → would normally prompt. Unattended must allow.
    const result = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });

    expect(result).toBeUndefined();
    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "allow", ruleId: "autonomy:unattended" }),
    );
  });

  it("does not persist allow rules — no ceiling mutation across calls", async () => {
    const permissions = makePermissions();
    const rememberSpy = vi.spyOn(permissions, "remember");
    const handler = makeBeforeToolHandler(
      permissions,
      makeSpec(),
      promptThatThrows,
      true,
      undefined,
      basePolicy,
      undefined,
      { sessionId: "s1", agentType: "parent" },
      "unattended",
    );

    // Two DIFFERENT bash commands. bash is critical-tier → would prompt under
    // attended. Under unattended both must be auto-allowed WITHOUT writing any
    // session rule (which, for bash, would persist the command as a glob).
    const first = await handler({ toolName: "bash", input: { command: "rm -rf build/*" } });
    const second = await handler({ toolName: "bash", input: { command: "grep 'a|b' ." } });

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();

    // No session rule was ever persisted — the ceiling is never mutated.
    expect(rememberSpy).not.toHaveBeenCalled();

    // The second command was evaluated independently, not matched against a glob
    // persisted by the first. With no session rules, exec stays "ask" (the
    // unattended branch, not a leaked "allow", is what permitted it).
    expect(permissions.evaluate("exec", "any-other-command")).toBe("ask");
  });

  it("attended (default) still prompts — unchanged behavior", async () => {
    const promptUser = vi.fn(async () => true);
    const handler = makeBeforeToolHandler(
      makePermissions(),
      makeSpec(),
      promptUser,
      true,
      undefined,
      basePolicy,
      undefined,
      { sessionId: "s1", agentType: "parent" },
      "attended",
    );

    const result = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });

    expect(result).toBeUndefined();
    expect(promptUser).toHaveBeenCalledTimes(1);
  });

  it("still BLOCKS on policy deny (deny wins over unattended)", async () => {
    const denyPolicy: HarnessPolicy = {
      ...basePolicy,
      rules: [{ id: "no-edits", capability: "edit", decision: "deny", reason: "test deny" }],
    };
    const auditLogger = { record: vi.fn(async () => undefined) };
    const handler = makeBeforeToolHandler(
      makePermissions(),
      makeSpec(),
      promptThatThrows,
      true,
      undefined,
      denyPolicy,
      auditLogger as never,
      { sessionId: "s1", agentType: "parent" },
      "unattended",
    );

    const result = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });

    expect(result?.block).toBe(true);
    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "deny", ruleId: "no-edits" }),
    );
  });

  it("still BLOCKS on permission deny", async () => {
    const permissions = makePermissions();
    // Session rule forcing a permission-level deny for edits.
    permissions.remember("edit", "**", "deny");
    const handler = makeBeforeToolHandler(
      permissions,
      makeSpec(),
      promptThatThrows,
      true,
      undefined,
      basePolicy,
      undefined,
      { sessionId: "s1", agentType: "parent" },
      "unattended",
    );

    const result = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("denied");
  });

  it("does NOT auto-allow an unrecognized tool that matched no policy rule", async () => {
    const auditLogger = { record: vi.fn(async () => undefined) };
    const handler = makeBeforeToolHandler(
      makePermissions(),
      makeSpec(),
      promptThatThrows, // no UI below, so this must never even be reached
      false, // no UI — the common unattended shape
      undefined,
      basePolicy, // rules: [] — no explicit policy rule can match
      auditLogger as never,
      { sessionId: "s1", agentType: "parent" },
      "unattended",
    );

    const result = await handler({ toolName: "mcp__some-server__deploy", input: {} });

    expect(result?.block).toBe(true);
    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "deny" }),
    );
  });

  it("DOES auto-allow an unrecognized tool when an explicit policy rule allows it", async () => {
    const auditLogger = { record: vi.fn(async () => undefined) };
    const trustingPolicy: HarnessPolicy = {
      ...basePolicy,
      rules: [{ id: "trust-deploy-mcp", capability: "exec", pattern: "mcp__some-server__deploy", decision: "allow", reason: "vetted integration" }],
    };
    const handler = makeBeforeToolHandler(
      makePermissions(),
      makeSpec(),
      promptThatThrows,
      false, // no UI — proves the allow came from the policy match, not a prompt
      undefined,
      trustingPolicy,
      auditLogger as never,
      { sessionId: "s1", agentType: "parent" },
      "unattended",
    );

    const result = await handler({ toolName: "mcp__some-server__deploy", input: {} });

    expect(result).toBeUndefined();
    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "allow", ruleId: "trust-deploy-mcp" }),
    );
  });

  it("still BLOCKS on an active explicit-spec capability restriction", async () => {
    const spec = makeSpec();
    const explicitSpec: FormalSpec = {
      id: "spec-1",
      tier: "explicit",
      status: "active",
      approvalStatus: "approved", // already approved — only scope restriction matters
      goal: "read-only task",
      taskContract: {
        objective: "read-only task",
        criteria: [],
      },
      allowedCapabilities: ["read"], // edit is NOT allowed
      constraints: [],
      acceptanceCriteria: [],
      targetFiles: [],
      risks: [],
      createdAt: Date.now(),
    };
    spec.activeSpec = explicitSpec;

    const handler = makeBeforeToolHandler(
      makePermissions(),
      spec,
      promptThatThrows,
      true,
      undefined,
      basePolicy,
      undefined,
      { sessionId: "s1", agentType: "parent" },
      "unattended",
    );

    const result = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("explicit spec scope");
  });
});
