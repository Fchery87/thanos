import { describe, expect, it, vi } from "vitest";
import { PermissionManager } from "../../src/permissions/manager";
import type { HarnessPolicy } from "../../src/policy/types";
import { authorizeVia, personalPolicy } from "../helpers/authorize";

// A prompt callback that fails the test if it is ever called. Used to prove the
// unattended branch never reaches the interactive confirmation.
const promptThatThrows = async (): Promise<boolean> => {
  throw new Error("promptUser must NOT be called under unattended autonomy");
};

describe("unattended autonomy gate (live GovernanceRuntime.authorize)", () => {
  it("auto-approves an edit the ceiling permits WITHOUT prompting", async () => {
    const recordAudit = vi.fn(async () => undefined);
    // edit → "ask" by default → would normally prompt. Unattended must allow.
    const decision = await authorizeVia(
      { autonomy: "unattended", promptUser: promptThatThrows, recordAudit },
      "edit",
      { file_path: "src/foo.ts" },
    );

    expect(decision.block).toBe(false);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "allow", ruleId: "autonomy:unattended" }),
    );
  });

  it("does not persist allow rules — no ceiling mutation across calls", async () => {
    const permissions = new PermissionManager();
    const rememberSpy = vi.spyOn(permissions, "remember");

    // Two DIFFERENT bash commands. bash is critical-tier → would prompt under
    // attended. Under unattended both must be auto-allowed WITHOUT writing any
    // session rule (which, for bash, would persist the command as a glob).
    const first = await authorizeVia(
      { autonomy: "unattended", permissions, promptUser: promptThatThrows },
      "bash",
      { command: "rm -rf build/*" },
    );
    const second = await authorizeVia(
      { autonomy: "unattended", permissions, promptUser: promptThatThrows },
      "bash",
      { command: "grep 'a|b' ." },
    );

    expect(first.block).toBe(false);
    expect(second.block).toBe(false);

    // No session rule was ever persisted — the ceiling is never mutated.
    expect(rememberSpy).not.toHaveBeenCalled();

    // With no session rules, exec stays "ask" (the unattended branch, not a
    // leaked "allow", is what permitted the calls).
    expect(permissions.evaluate("exec", "any-other-command")).toBe("ask");
  });

  it("attended (default) still prompts — unchanged behavior", async () => {
    const promptUser = vi.fn(async () => true);
    const decision = await authorizeVia(
      { autonomy: "attended", promptUser },
      "edit",
      { file_path: "src/foo.ts" },
    );

    expect(decision.block).toBe(false);
    expect(promptUser).toHaveBeenCalledTimes(1);
  });

  it("still BLOCKS on policy deny (deny wins over unattended)", async () => {
    const denyPolicy: HarnessPolicy = {
      ...personalPolicy,
      rules: [{ id: "no-edits", capability: "edit", decision: "deny", reason: "test deny" }],
    };
    const recordAudit = vi.fn(async () => undefined);
    const decision = await authorizeVia(
      { autonomy: "unattended", policy: denyPolicy, promptUser: promptThatThrows, recordAudit },
      "edit",
      { file_path: "src/foo.ts" },
    );

    expect(decision.block).toBe(true);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "deny", ruleId: "no-edits" }),
    );
  });

  it("still BLOCKS on permission deny", async () => {
    const permissions = new PermissionManager();
    // Session rule forcing a permission-level deny for edits.
    permissions.remember("edit", "**", "deny");
    const decision = await authorizeVia(
      { autonomy: "unattended", permissions, promptUser: promptThatThrows },
      "edit",
      { file_path: "src/foo.ts" },
    );

    expect(decision.block).toBe(true);
    expect(decision.reason).toContain("denied");
  });

  it("does NOT auto-allow an unrecognized tool that matched no policy rule", async () => {
    const recordAudit = vi.fn(async () => undefined);
    const decision = await authorizeVia(
      // no UI — the common unattended shape; basePolicy has no matching rule.
      { autonomy: "unattended", hasUI: false, promptUser: promptThatThrows, recordAudit },
      "mcp__some-server__deploy",
      {},
    );

    expect(decision.block).toBe(true);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "deny" }),
    );
  });

  it("DOES auto-allow an unrecognized tool when an explicit policy rule allows it", async () => {
    const recordAudit = vi.fn(async () => undefined);
    const trustingPolicy: HarnessPolicy = {
      ...personalPolicy,
      rules: [{ id: "trust-deploy-mcp", capability: "exec", pattern: "mcp__some-server__deploy", decision: "allow", reason: "vetted integration" }],
    };
    const decision = await authorizeVia(
      // no UI — proves the allow came from the policy match, not a prompt.
      { autonomy: "unattended", hasUI: false, policy: trustingPolicy, promptUser: promptThatThrows, recordAudit },
      "mcp__some-server__deploy",
      {},
    );

    expect(decision.block).toBe(false);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "allow", ruleId: "trust-deploy-mcp" }),
    );
  });

  it("still BLOCKS on an active explicit-spec capability restriction", async () => {
    // An approved explicit spec scoped to ["read"] must block an edit — now
    // enforced in the live path via GovernanceContext.specScope.
    const decision = await authorizeVia(
      { autonomy: "unattended", specScope: ["read"], promptUser: promptThatThrows },
      "edit",
      { file_path: "src/foo.ts" },
    );

    expect(decision.block).toBe(true);
    expect(decision.reason).toContain("explicit spec scope");
  });
});
