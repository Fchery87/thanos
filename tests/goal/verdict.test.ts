import { describe, expect, it } from "vitest";
import { parseVerdict } from "../../src/goal/verdict";

describe("parseVerdict", () => {
  it("parses MET", () => {
    expect(parseVerdict("VERDICT: MET\nREASON: all tests pass"))
      .toEqual({ met: true, reason: "all tests pass" });
  });

  it("parses NOT_MET case-insensitively and with surrounding text", () => {
    expect(parseVerdict("blah\nverdict: not_met\nreason: 2 tests failing\nmore"))
      .toEqual({ met: false, reason: "2 tests failing" });
  });

  it("treats unparseable output as NOT_MET (fail-safe)", () => {
    const v = parseVerdict("I think it looks good?");
    expect(v.met).toBe(false);
    expect(v.reason).toMatch(/unreadable/i);
  });

  it("defaults reason when REASON line missing", () => {
    expect(parseVerdict("VERDICT: MET")).toEqual({ met: true, reason: "condition met" });
  });
});
