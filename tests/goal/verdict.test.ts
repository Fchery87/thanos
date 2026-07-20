import { describe, expect, it } from "vitest";
import { parseVerdict } from "../../src/goal/verdict";

describe("parseVerdict", () => {
  it("parses MET", () => {
    expect(parseVerdict("VERDICT: MET\nREASON: all tests pass"))
      .toEqual({ met: true, reason: "all tests pass" });
  });

  it("rejects surrounding text and fails closed", () => {
    expect(parseVerdict("blah\nVERDICT: NOT_MET\nREASON: 2 tests failing\nmore"))
      .toEqual({ met: false, reason: "evaluator output unreadable: blah VERDICT: NOT_MET REASON: 2 tests failing more" });
  });

  it("treats unparseable output as NOT_MET (fail-safe)", () => {
    const v = parseVerdict("I think it looks good?");
    expect(v.met).toBe(false);
    expect(v.reason).toMatch(/unreadable/i);
  });

  it("requires a reason line for MET", () => {
    expect(parseVerdict("VERDICT: MET")).toEqual({ met: false, reason: "evaluator output unreadable: VERDICT: MET" });
  });

  it("treats contradictory verdicts as NOT_MET", () => {
    const v = parseVerdict("VERDICT: MET\nREASON: done\nVERDICT: NOT_MET\nREASON: actually no");
    expect(v.met).toBe(false);
    expect(v.reason).toMatch(/unreadable/i);
  });
});
