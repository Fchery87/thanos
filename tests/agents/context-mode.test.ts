import { describe, expect, it } from "vitest";
import { buildContextArgs, resolveContextMode } from "../../src/agents/context-mode";

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

  it.each(["explore", "plan", "reviewer", "oracle", "researcher"] as const)(
    "throws when forked is requested for adversarial role %s",
    (type) => {
      expect(() => resolveContextMode(type, "forked")).toThrow(/forked/i);
    },
  );
});

describe("buildContextArgs", () => {
  it("uses an isolated session for fresh mode", () => {
    expect(buildContextArgs("fresh")).toEqual(["--no-session"]);
  });
  it("forks from the parent session reference when forked + ref provided", () => {
    expect(buildContextArgs("forked", "abc123")).toEqual(["--fork", "abc123"]);
  });
  it("falls back to ephemeral when forked but no parent ref is available", () => {
    expect(buildContextArgs("forked", undefined)).toEqual(["--no-session"]);
  });
});
