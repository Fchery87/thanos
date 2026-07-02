import { describe, expect, it } from "vitest";
import { parseGoalCommand } from "../../src/goal/command-parse";

describe("parseGoalCommand", () => {
  it("no args → status", () => {
    expect(parseGoalCommand("")).toEqual({ type: "status" });
    expect(parseGoalCommand("   ")).toEqual({ type: "status" });
  });
  it("clear + aliases", () => {
    for (const a of ["clear", "stop", "off", "reset", "none", "cancel", "CLEAR"]) {
      expect(parseGoalCommand(a)).toEqual({ type: "clear" });
    }
  });
  it("pause / resume", () => {
    expect(parseGoalCommand("pause")).toEqual({ type: "pause" });
    expect(parseGoalCommand("resume")).toEqual({ type: "resume" });
  });
  it("anything else → set with trimmed condition", () => {
    expect(parseGoalCommand("  all tests pass  ")).toEqual({ type: "set", condition: "all tests pass" });
  });
  it("a condition that starts with a keyword but has more words is a set", () => {
    expect(parseGoalCommand("stop the flaky test from failing"))
      .toEqual({ type: "set", condition: "stop the flaky test from failing" });
  });
});
