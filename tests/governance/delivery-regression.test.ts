import { describe, expect, it, vi } from "vitest";
import { resolveDelivery } from "../../src/governance/delivery";
import { deliveryPolicyOverlay } from "../../src/governance/delivery-overlay";
import { makeBeforeToolHandler } from "../../src/hooks/before-tool";
import { PermissionManager } from "../../src/permissions/manager";
import { SpecEngine } from "../../src/spec/engine";
import type { HarnessPolicy } from "../../src/policy/types";

/**
 * Additive-default guarantee: with NO registry, NO ship file, and global yolo
 * OFF, the delivery-modes / yolo-lockout feature is inert — the system behaves
 * exactly as it did before the feature existed.
 */

const basePolicy: HarnessPolicy = {
  version: 1,
  preset: "personal",
  rules: [],
  audit: { enabled: true },
  headless: { defaultDecision: "allow" },
};

// yolo OFF so the real evaluate/deny logic runs; `edit` is "ask" by default.
function makePermissions() {
  const permissions = new PermissionManager();
  permissions.setYolo(false);
  return permissions;
}
function makeSpec() {
  return new SpecEngine();
}

describe("delivery additive-default regression", () => {
  it("no registry + no ship file → safe defaults, empty gates, merge defaulted", () => {
    const r = resolveDelivery({
      registry: null,
      shipFile: null,
      repoId: { remote: null, path: "/some/repo" },
    });

    expect(r.mode).toBe("local-only");
    expect(r.autonomy).toBe("attended");
    expect(r.gates).toEqual({});
    expect(r.defaultBranch).toBe("main");
    expect(r.merge).toBe("fast-forward"); // derived default for local-only
    expect(r.yoloLocked).toBe(false);
  });

  it("deliveryPolicyOverlay adds NO rules for direct-PR or no-mistakes", () => {
    // Only local-only adds a deny; the non-local-only modes leave policy
    // unchanged, so a session running under them is not altered by the feature.
    expect(deliveryPolicyOverlay("direct-PR")).toEqual([]);
    expect(deliveryPolicyOverlay("no-mistakes")).toEqual([]);
  });

  it("attended (default) handler is identical to one constructed WITHOUT the autonomy arg", async () => {
    // edit → "ask" by default → both handlers must reach the interactive prompt.
    const promptExplicit = vi.fn(async () => true);
    const handlerExplicit = makeBeforeToolHandler(
      makePermissions(),
      makeSpec(),
      promptExplicit,
      true,
      undefined,
      basePolicy,
      undefined,
      { sessionId: "s1", agentType: "parent" },
      "attended", // explicit default
    );

    const promptOmitted = vi.fn(async () => true);
    const handlerOmitted = makeBeforeToolHandler(
      makePermissions(),
      makeSpec(),
      promptOmitted,
      true,
      undefined,
      basePolicy,
      undefined,
      { sessionId: "s1", agentType: "parent" },
      // autonomy arg omitted entirely — proves the feature is inert by default.
    );

    const resultExplicit = await handlerExplicit({
      toolName: "edit",
      input: { file_path: "src/foo.ts" },
    });
    const resultOmitted = await handlerOmitted({
      toolName: "edit",
      input: { file_path: "src/foo.ts" },
    });

    // Both prompt exactly once and return the same (undefined → not blocked).
    expect(promptExplicit).toHaveBeenCalledTimes(1);
    expect(promptOmitted).toHaveBeenCalledTimes(1);
    expect(resultExplicit).toBeUndefined();
    expect(resultOmitted).toBeUndefined();
    expect(resultExplicit).toEqual(resultOmitted);
  });
});
