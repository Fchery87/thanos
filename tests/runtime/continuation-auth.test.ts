import { describe, expect, it } from "vitest";
import { consumeContinuation, hasContinuation, issueContinuation } from "../../src/runtime/continuation-auth";

describe("continuation-auth", () => {
  it("issues an opaque continuation id and consumes it exactly once", () => {
    const issued = issueContinuation("s1", "spec", "follow-up");
    expect(issued.id.length).toBeGreaterThan(0);
    expect(hasContinuation("s1", "spec")).toBe(true);
    expect(consumeContinuation("s1", "spec", "follow-up")).toBe(true);
    expect(consumeContinuation("s1", "spec", "follow-up")).toBe(false);
  });

  it("rejects kind mismatches and replay", () => {
    const issued = issueContinuation("s2", "goal", "goal-follow-up");
    expect(issued.id.includes("s2:goal")).toBe(false);
    expect(consumeContinuation("s2", "spec", "goal-follow-up")).toBe(false);
    expect(consumeContinuation("s2", "goal", "wrong")).toBe(false);
  });

  it("rejects cross-session reuse", () => {
    const issued = issueContinuation("s3", "spec", "follow-up");
    expect(issued.id.length).toBeGreaterThan(0);
    expect(consumeContinuation("other-session", "spec", "follow-up")).toBe(false);
  });

  it("rejects expired continuations", () => {
    const issued = issueContinuation("s4", "goal", "follow-up", { now: 100, ttlMs: 10 });
    expect(issued.id.length).toBeGreaterThan(0);
    expect(consumeContinuation("s4", "goal", "follow-up", { now: 111 })).toBe(false);
  });
});
