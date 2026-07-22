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

describe("PermissionManager.evaluate() — deny wins over yolo", () => {
  it("returns allow under yolo when no deny matches", () => {
    const pm = new PermissionManager();
    pm.setYolo(true);
    expect(pm.evaluate("edit", "src/x.ts")).toBe("allow");
    expect(pm.evaluate("exec", "rm -rf build")).toBe("allow");
  });

  it("a session-remembered deny still blocks even under yolo", () => {
    const pm = new PermissionManager();
    pm.remember("edit", "**", "deny");
    pm.setYolo(true);
    // yolo bypasses prompts/risk gating, never an explicit deny.
    expect(pm.evaluate("edit", "src/x.ts")).toBe("deny");
    // A capability with no matching deny still short-circuits to allow.
    expect(pm.evaluate("exec", "echo hi")).toBe("allow");
  });

  it("a wildcard deny (e.g. from a rejected spec) blocks every capability under yolo", () => {
    const pm = new PermissionManager();
    pm.remember("*", "**", "deny");
    pm.setYolo(true);
    expect(pm.evaluate("read", "src/x.ts")).toBe("deny");
    expect(pm.evaluate("edit", "src/x.ts")).toBe("deny");
    expect(pm.evaluate("exec", "ls")).toBe("deny");
  });
});
