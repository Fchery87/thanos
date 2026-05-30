import { describe, expect, it } from "vitest";
import { resolveContextMode } from "../../src/agents/context-mode";

describe("resolveContextMode", () => {
  it("defaults to fresh when unspecified", () => {
    expect(resolveContextMode("build", undefined)).toBe("fresh");
    expect(resolveContextMode("oracle", undefined)).toBe("fresh");
  });

  it("allows forked for continuity roles", () => {
    expect(resolveContextMode("build", "forked")).toBe("forked");
    expect(resolveContextMode("designer", "forked")).toBe("forked");
  });

  it("allows an explicit fresh for any role", () => {
    expect(resolveContextMode("oracle", "fresh")).toBe("fresh");
    expect(resolveContextMode("designer", "fresh")).toBe("fresh");
  });

  it.each(["explore", "plan", "reviewer", "oracle"] as const)(
    "throws when forked is requested for adversarial role %s",
    (type) => {
      expect(() => resolveContextMode(type, "forked")).toThrow(/forked/i);
    },
  );
});
