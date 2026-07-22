import { describe, expect, it, vi } from "vitest";
import { resolveDelivery } from "../../src/governance/delivery";
import { deliveryPolicyOverlay } from "../../src/governance/delivery-overlay";
import { authorizeVia } from "../helpers/authorize";

/**
 * Additive-default guarantee: with NO registry, NO ship file, and global yolo
 * OFF, the delivery-modes / yolo-lockout feature is inert — the system behaves
 * exactly as it did before the feature existed.
 */

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

  it("attended default with no delivery overlay behaves as a plain permission gate", async () => {
    // edit → "ask" by default → attended must reach the interactive prompt once
    // and then allow. With no registry/overlay in force (deliveryMode undefined),
    // the gate is a plain permission prompt — the feature is inert by default.
    const promptUser = vi.fn(async () => true);
    const decision = await authorizeVia(
      { autonomy: "attended", deliveryMode: undefined, promptUser },
      "edit",
      { file_path: "src/foo.ts" },
    );

    expect(promptUser).toHaveBeenCalledTimes(1);
    expect(decision.block).toBe(false);
  });
});
