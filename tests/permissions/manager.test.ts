import { describe, expect, it } from "vitest";
import { PermissionManager } from "../../src/permissions/manager";

describe("PermissionManager.remember() pattern validation", () => {
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
