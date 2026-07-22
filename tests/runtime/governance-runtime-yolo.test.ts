import { describe, expect, it, vi } from "vitest";
import { GovernanceRuntime, type GovernanceContext } from "../../src/runtime/governance-runtime";
import { PermissionManager } from "../../src/permissions/manager";
import type { HarnessPolicy } from "../../src/policy/types";

const basePolicy: HarnessPolicy = {
  version: 1,
  preset: "personal",
  rules: [],
  audit: { enabled: true },
  headless: { defaultDecision: "allow" },
};

function makeCtx(overrides: Partial<GovernanceContext> = {}): GovernanceContext {
  const permissions = overrides.permissions ?? new PermissionManager();
  return {
    policy: basePolicy,
    permissions,
    yolo: true,
    autonomy: "attended",
    deliveryMode: "direct-PR",
    childRole: undefined,
    specScope: undefined,
    hasUI: true,
    sessionId: "s1",
    agentType: "parent",
    // promptUser must never be reached under yolo — it throws if it is.
    promptUser: async () => {
      throw new Error("promptUser must NOT be called under yolo");
    },
    recordAudit: async () => undefined,
    ...overrides,
  };
}

describe("GovernanceRuntime.authorize — yolo preserves the protection floor", () => {
  it("allows a critical bash WITHOUT prompting and signals a rollback snapshot", async () => {
    const permissions = new PermissionManager();
    permissions.setYolo(true);
    const gov = new GovernanceRuntime(makeCtx({ permissions, yolo: true }));

    const decision = await gov.authorize("bash", { command: "rm -rf build" });

    expect(decision.block).toBe(false);
    // critical op under yolo still gets a pre-op snapshot.
    expect(decision.snapshotNeeded).toBe(true);
  });

  it("still BLOCKS on a permission-manager deny even under yolo", async () => {
    const permissions = new PermissionManager();
    permissions.remember("exec", "**", "deny");
    permissions.setYolo(true);
    const gov = new GovernanceRuntime(makeCtx({ permissions, yolo: true }));

    const decision = await gov.authorize("bash", { command: "rm -rf build" });

    expect(decision.block).toBe(true);
    expect(decision.reason).toContain("denied");
  });

  it("still BLOCKS on an explicit policy deny even under yolo", async () => {
    const denyPolicy: HarnessPolicy = {
      ...basePolicy,
      rules: [{ id: "no-exec", capability: "exec", pattern: "**", decision: "deny", reason: "test deny" }],
    };
    const permissions = new PermissionManager();
    permissions.setYolo(true);
    const gov = new GovernanceRuntime(makeCtx({ permissions, yolo: true, policy: denyPolicy }));

    const decision = await gov.authorize("bash", { command: "echo hi" });

    expect(decision.block).toBe(true);
  });

  it("records the audit reason as 'yolo' when it allows", async () => {
    const permissions = new PermissionManager();
    permissions.setYolo(true);
    const recordAudit = vi.fn(async () => undefined);
    const gov = new GovernanceRuntime(makeCtx({ permissions, yolo: true, recordAudit }));

    await gov.authorize("edit", { file_path: "src/foo.ts" });

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "allow", ruleId: "yolo" }),
    );
  });

  it("a non-critical yolo allow does not request a snapshot", async () => {
    const permissions = new PermissionManager();
    permissions.setYolo(true);
    const gov = new GovernanceRuntime(makeCtx({ permissions, yolo: true }));

    const decision = await gov.authorize("edit", { file_path: "src/foo.ts" });

    expect(decision.block).toBe(false);
    expect(decision.snapshotNeeded).toBeFalsy();
  });
});
