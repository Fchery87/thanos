import { describe, expect, it } from "vitest";
import { PermissionManager } from "../../src/permissions/manager";

describe("PermissionManager.remember() pattern validation", () => {
  it("defaults to yolo OFF so the delivery ceiling is effective by default", () => {
    const pm = new PermissionManager();
    expect(pm.isYolo).toBe(false);
    // With yolo off, evaluate falls through to the default rules rather than allow-all.
    expect(pm.evaluate("read", "src/x.ts")).toBe("allow");
    expect(pm.evaluate("edit", "src/x.ts")).toBe("ask");
  });

  it("throws when pattern is an empty string", () => {
    const pm = new PermissionManager();
    expect(() => pm.remember("exec", "", "allow")).toThrowError(/pattern/);
  });

  it("throws when pattern is whitespace-only", () => {
    const pm = new PermissionManager();
    expect(() => pm.remember("exec", "  ", "allow")).toThrowError(/pattern/);
  });

  it("does not throw when pattern is a valid wildcard", () => {
    const pm = new PermissionManager();
    expect(() => pm.remember("exec", "**", "allow")).not.toThrow();
  });

  it("does not throw when pattern is a non-empty string", () => {
    const pm = new PermissionManager();
    expect(() => pm.remember("read", "/home/**", "allow")).not.toThrow();
  });
});
