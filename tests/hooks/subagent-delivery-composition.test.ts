import { describe, expect, it, vi } from "vitest";
import { authorizeVia } from "../helpers/authorize";

/**
 * Security-critical composition test through the LIVE gate.
 *
 * A child of an `unattended` + `local-only` repo runs headless (auto-approving
 * what the ceiling permits) WHILE local-only still denies `git push`. authorize()
 * applies the delivery overlay + the argv-level push guard from the resolved
 * deliveryMode, so passing `deliveryMode: "local-only"` + `autonomy: "unattended"`
 * exercises the real composition. Proves: (a) a ceiling-permitted edit is
 * auto-approved without any prompt, and (b) a `git push` exec is still BLOCKED —
 * the local-only guard wins over unattended.
 */

const promptThatThrows = async (): Promise<boolean> => {
  throw new Error("promptUser must NOT be called for a headless subagent");
};

function localOnlyChild(recordAudit = vi.fn(async () => undefined)) {
  return {
    deliveryMode: "local-only" as const,
    autonomy: "unattended" as const,
    hasUI: false,
    agentType: "subagent" as const,
    promptUser: promptThatThrows,
    recordAudit,
  };
}

describe("subagent delivery composition (unattended + local-only)", () => {
  it("auto-approves a ceiling-permitted edit WITHOUT prompting", async () => {
    const recordAudit = vi.fn(async () => undefined);
    // edit → "ask" by default → unattended must auto-allow (overlay only denies push).
    const decision = await authorizeVia(localOnlyChild(recordAudit), "edit", { file_path: "src/foo.ts" });

    expect(decision.block).toBe(false);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "allow", ruleId: "autonomy:unattended" }),
    );
  });

  it("still BLOCKS a git push exec — the local-only guard wins over unattended", async () => {
    const decision = await authorizeVia(localOnlyChild(), "bash", { command: "git push origin main" });

    expect(decision.block).toBe(true);
    expect(decision.reason).toContain("local-only");
  });

  it("blocks the bare `git push` form too", async () => {
    const decision = await authorizeVia(localOnlyChild(), "bash", { command: "git push" });

    expect(decision.block).toBe(true);
    expect(decision.reason).toContain("local-only");
  });

  it("blocks an interposed-flag push form (git -C dir push) as well", async () => {
    const decision = await authorizeVia(localOnlyChild(), "bash", { command: "git -C /repo push origin main" });

    expect(decision.block).toBe(true);
    expect(decision.reason).toContain("local-only");
  });
});
