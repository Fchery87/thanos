import { describe, expect, it, vi } from "vitest";
import { authorizeVia } from "../helpers/authorize";

/**
 * Role-narrowing enforcement through the LIVE gate: authorize() applies
 * roleNarrowingOverlay(childRole) via buildEffectivePolicy, so passing a
 * `childRole` exercises the real wiring the `pi.on("tool_call")` gate uses for a
 * subagent child. Proves the narrowing rule wins over both a broad ceiling allow
 * and unattended autonomy's "trust the ceiling" bypass.
 */

const promptThatThrows = async (): Promise<boolean> => {
  throw new Error("promptUser must NOT be called for a headless subagent");
};

// Common context for a headless, unattended subagent child of a given role.
function child(role: string | undefined, recordAudit = vi.fn(async () => undefined)) {
  return {
    autonomy: "unattended" as const,
    hasUI: false,
    childRole: role,
    agentType: "subagent" as const,
    promptUser: promptThatThrows,
    recordAudit,
  };
}

describe("role-narrowing composition (unattended live subagent)", () => {
  it("denies edit for a read-only role's child, naming the narrowing rule's reason", async () => {
    const recordAudit = vi.fn(async () => undefined);
    const decision = await authorizeVia(child("explore", recordAudit), "edit", { file_path: "src/foo.ts" });

    expect(decision.block).toBe(true);
    expect(decision.reason).toContain("role-deny-edit");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "deny", ruleId: "role-deny-edit" }),
    );
  });

  it("denies exec for a read-only role's child — deny wins over unattended", async () => {
    const decision = await authorizeVia(child("reviewer"), "bash", { command: "ls -la" });

    expect(decision.block).toBe(true);
    expect(decision.reason).toContain("role-deny-exec");
  });

  it("evaluator: exec is allowed per the ceiling, edit is denied", async () => {
    const execDecision = await authorizeVia(child("evaluator"), "bash", { command: "npm test" });
    expect(execDecision.block).toBe(false); // no rule denies exec — unattended trusts the ceiling

    const editDecision = await authorizeVia(child("evaluator"), "edit", { file_path: "src/foo.ts" });
    expect(editDecision.block).toBe(true);
    expect(editDecision.reason).toContain("role-deny-edit");
  });

  it("designer: edit is allowed per the ceiling, exec is denied", async () => {
    const editDecision = await authorizeVia(child("designer"), "edit", { file_path: "src/foo.ts" });
    expect(editDecision.block).toBe(false);

    const execDecision = await authorizeVia(child("designer"), "bash", { command: "rm -rf tmp" });
    expect(execDecision.block).toBe(true);
    expect(execDecision.reason).toContain("role-deny-exec");
  });

  it("writer role (build): no narrowing — both edit and exec follow the ceiling", async () => {
    const editDecision = await authorizeVia(child("build"), "edit", { file_path: "src/foo.ts" });
    expect(editDecision.block).toBe(false);

    const execDecision = await authorizeVia(child("build"), "bash", { command: "npm test" });
    expect(execDecision.block).toBe(false);
  });

  it("undefined role (parent session): no narrowing", async () => {
    const decision = await authorizeVia(child(undefined), "edit", { file_path: "src/foo.ts" });
    expect(decision.block).toBe(false);
  });
});
