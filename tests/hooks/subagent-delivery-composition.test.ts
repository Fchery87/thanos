import { describe, expect, it, vi } from "vitest";
import { makeBeforeToolHandler } from "../../src/hooks/before-tool";
import { PermissionManager } from "../../src/permissions/manager";
import { SpecEngine } from "../../src/spec/engine";
import { deliveryPolicyOverlay } from "../../src/governance/delivery-overlay";
import type { HarnessPolicy } from "../../src/policy/types";

/**
 * Security-critical composition test for Task 7c.
 *
 * Subagents now resolve their own delivery state (see src/index.ts), so a child
 * of an `unattended` + `local-only` repo runs headless (auto-approving what the
 * ceiling permits) WHILE the local-only overlay still denies `git push`.
 *
 * This reconstructs the exact composition the `pi.on("tool_call")` gate builds
 * (overlay rules PREPENDED onto the base policy, autonomy = "unattended") and
 * proves: (a) a ceiling-permitted edit is auto-approved without any prompt, and
 * (b) a `git push` exec is still BLOCKED — the overlay deny wins over unattended.
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
  permissions.setYolo(false); // yolo OFF — exercise the real evaluate/deny path
  return permissions;
}

// Fails the test if the interactive prompt is ever reached: under unattended a
// ceiling-permitted call must auto-approve, and a denied call must block —
// neither should prompt (a subagent has no UI anyway).
const promptThatThrows = async (): Promise<boolean> => {
  throw new Error("promptUser must NOT be called for a headless subagent");
};

// Mirror the gate: PREPEND the delivery overlay onto the base policy rules.
function composeGatePolicy(): HarnessPolicy {
  const overlay = deliveryPolicyOverlay("local-only");
  expect(overlay.length).toBeGreaterThan(0); // sanity: local-only adds the push deny
  return { ...basePolicy, rules: [...overlay, ...basePolicy.rules] };
}

describe("subagent delivery composition (unattended + local-only)", () => {
  it("auto-approves a ceiling-permitted edit WITHOUT prompting", async () => {
    const auditLogger = { record: vi.fn(async () => undefined) };
    const handler = makeBeforeToolHandler(
      makePermissions(),
      new SpecEngine(),
      promptThatThrows,
      false, // no UI — this is a subagent
      undefined,
      composeGatePolicy(),
      auditLogger as never,
      { sessionId: "child-1", agentType: "subagent" },
      "unattended",
    );

    // edit → "ask" by default → unattended must auto-allow (overlay only denies push).
    const result = await handler({ toolName: "edit", input: { file_path: "src/foo.ts" } });

    expect(result).toBeUndefined();
    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "allow", ruleId: "autonomy:unattended" }),
    );
  });

  it("still BLOCKS a git push exec — overlay deny wins over unattended", async () => {
    const auditLogger = { record: vi.fn(async () => undefined) };
    const handler = makeBeforeToolHandler(
      makePermissions(),
      new SpecEngine(),
      promptThatThrows,
      false, // no UI — this is a subagent
      undefined,
      composeGatePolicy(),
      auditLogger as never,
      { sessionId: "child-1", agentType: "subagent" },
      "unattended",
    );

    const result = await handler({ toolName: "bash", input: { command: "git push origin main" } });

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("local-only");
    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "deny", ruleId: "delivery-local-only-no-push" }),
    );
  });

  it("blocks the bare `git push` form too", async () => {
    const handler = makeBeforeToolHandler(
      makePermissions(),
      new SpecEngine(),
      promptThatThrows,
      false,
      undefined,
      composeGatePolicy(),
      undefined,
      { sessionId: "child-1", agentType: "subagent" },
      "unattended",
    );

    const result = await handler({ toolName: "bash", input: { command: "git push" } });

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("local-only");
  });
});
