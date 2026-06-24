import { describe, expect, it } from "vitest";
import { PermissionManager } from "../../src/permissions/manager";

describe("PermissionManager yolo lock", () => {
  it("forces yolo off and makes setYolo(true) a no-op when locked", () => {
    const pm = new PermissionManager();
    pm.lockYolo();
    expect(pm.yoloLocked).toBe(true);
    expect(pm.isYolo).toBe(false);
    pm.setYolo(true);
    expect(pm.isYolo).toBe(false);
  });

  it("evaluates with rules (not allow-all) when locked", () => {
    const pm = new PermissionManager();
    pm.lockYolo();
    expect(pm.evaluate("edit", "src/x.ts")).toBe("ask"); // default edit rule
  });

  it("lock overrides a previously-enabled yolo in evaluate()", () => {
    const pm = new PermissionManager();
    pm.setYolo(true);
    expect(pm.evaluate("edit", "x")).toBe("allow"); // yolo on
    pm.lockYolo();
    expect(pm.isYolo).toBe(false);
    expect(pm.evaluate("edit", "x")).toBe("ask");   // lock wins
  });
});
