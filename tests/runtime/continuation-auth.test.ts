import { describe, expect, it } from "vitest";
import { consumeContinuation, hasContinuation, issueContinuation } from "../../src/runtime/continuation-auth";

describe("continuation-auth", () => {
  it("issues and consumes a single exact continuation", () => {
    issueContinuation("s1", "spec", "follow-up");
    expect(hasContinuation("s1", "spec")).toBe(true);
    expect(consumeContinuation("s1", "spec", "follow-up")).toBe(true);
    expect(consumeContinuation("s1", "spec", "follow-up")).toBe(false);
  });

  it("rejects kind mismatches and replay", () => {
    issueContinuation("s2", "goal", "goal-follow-up");
    expect(consumeContinuation("s2", "spec", "goal-follow-up")).toBe(false);
    expect(consumeContinuation("s2", "goal", "wrong")).toBe(false);
  });
});
