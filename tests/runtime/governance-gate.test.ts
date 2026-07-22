import { describe, expect, it, vi } from "vitest";
import { PermissionManager } from "../../src/permissions/manager";
import type { HarnessPolicy } from "../../src/policy/types";
import { authorizeVia, personalPolicy } from "../helpers/authorize";

// Migrated from the retired hooks/before-tool handler: these exercise the live
// GovernanceRuntime.authorize gate directly.

function yoloPermissions() {
  const permissions = new PermissionManager();
  permissions.setYolo(true);
  return permissions;
}

describe("audit context threading", () => {
  it("uses the provided sessionId in audit records instead of 'unknown'", async () => {
    const recordAudit = vi.fn(async () => undefined);
    await authorizeVia(
      { yolo: true, permissions: yoloPermissions(), sessionId: "test-session-abc", recordAudit },
      "read",
      { file_path: "src/index.ts" },
    );

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "test-session-abc" }),
    );
  });

  it("uses the provided agentType in audit records", async () => {
    const recordAudit = vi.fn(async () => undefined);
    await authorizeVia(
      { yolo: true, permissions: yoloPermissions(), agentType: "subagent", recordAudit },
      "read",
      { file_path: "src/index.ts" },
    );

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: "subagent" }),
    );
  });
});

describe("unrecognized tools (e.g. MCP servers) — high risk tier gate", () => {
  it("attended: prompts for confirmation before an unrecognized tool runs", async () => {
    const promptUser = vi.fn(async () => true);
    const decision = await authorizeVia(
      { autonomy: "attended", hasUI: true, promptUser },
      "mcp__some-server__deploy",
      {},
    );

    expect(decision.block).toBe(false);
    expect(promptUser).toHaveBeenCalledTimes(1);
  });

  it("headless: denies an unrecognized tool instead of running it silently", async () => {
    const decision = await authorizeVia(
      { autonomy: "attended", hasUI: false },
      "mcp__some-server__deploy",
      {},
    );

    expect(decision.block).toBe(true);
  });

  it("does NOT extend the policy-allow bypass to an already-recognized high-risk tool", async () => {
    // A known tool (edit) keeps its prompt-then-remember behavior even when a
    // policy rule allows it — the escape hatch is specifically the
    // unrecognized-tool case, not a general "policy allow skips every prompt".
    const promptUser = vi.fn(async () => true);
    const allowEditPolicy: HarnessPolicy = {
      ...personalPolicy,
      rules: [{ id: "allow-all-edits", capability: "edit", pattern: "**", decision: "allow", reason: "test" }],
    };
    const decision = await authorizeVia(
      { autonomy: "attended", hasUI: true, policy: allowEditPolicy, promptUser },
      "edit",
      { file_path: "src/foo.ts" },
    );

    expect(decision.block).toBe(false);
    expect(promptUser).toHaveBeenCalledTimes(1);
  });

  it("an explicit policy allow rule permits an unrecognized tool without a prompt", async () => {
    const promptThatThrows = async (): Promise<boolean> => {
      throw new Error("promptUser must NOT be called when policy explicitly allows the call");
    };
    const trustingPolicy: HarnessPolicy = {
      ...personalPolicy,
      rules: [{ id: "trust-deploy-mcp", capability: "exec", pattern: "mcp__some-server__deploy", decision: "allow", reason: "vetted integration" }],
    };
    const decision = await authorizeVia(
      { autonomy: "attended", hasUI: true, policy: trustingPolicy, promptUser: promptThatThrows },
      "mcp__some-server__deploy",
      {},
    );

    expect(decision.block).toBe(false);
  });
});

describe("headless audit record correctness", () => {
  it("records 'deny' in audit when the headless gate blocks — not the defaultDecision value", async () => {
    const recordAudit = vi.fn(async () => undefined);
    const policyWithAllowDefault: HarnessPolicy = {
      ...personalPolicy,
      headless: { defaultDecision: "allow" },
    };
    // mutating bash is critical-tier, requires confirmation → blocks in headless.
    const decision = await authorizeVia(
      { autonomy: "attended", hasUI: false, policy: policyWithAllowDefault, recordAudit },
      "bash",
      { command: "rm -rf tmp" },
    );

    expect(decision.block).toBe(true);
    // Audit must record the actual decision ("deny"), not the config value.
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "deny" }),
    );
  });
});
