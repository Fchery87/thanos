import { describe, expect, it } from "vitest";
import { detectChildRole, isSubagentProcess } from "../../src/agents/child-role";

describe("isSubagentProcess", () => {
  it("is false for the main session (no subagent env vars set)", () => {
    expect(isSubagentProcess({})).toBe(false);
  });

  it("is true when the legacy HARNESS_SUBAGENT marker is set to a role name", () => {
    expect(isSubagentProcess({ HARNESS_SUBAGENT: "reviewer" })).toBe(true);
  });

  it("is true when the legacy HARNESS_SUBAGENT marker is the generic \"1\"", () => {
    expect(isSubagentProcess({ HARNESS_SUBAGENT: "1" })).toBe(true);
  });

  it("is true when the live PI_SUBAGENT_CHILD marker is \"1\"", () => {
    expect(isSubagentProcess({ PI_SUBAGENT_CHILD: "1" })).toBe(true);
  });

  it("is false when PI_SUBAGENT_CHILD is set to something other than \"1\"", () => {
    expect(isSubagentProcess({ PI_SUBAGENT_CHILD: "0" })).toBe(false);
  });
});

describe("detectChildRole", () => {
  it("returns undefined for the main session", () => {
    expect(detectChildRole({})).toBeUndefined();
  });

  it("returns the legacy role name when HARNESS_SUBAGENT carries one", () => {
    expect(detectChildRole({ HARNESS_SUBAGENT: "reviewer" })).toBe("reviewer");
  });

  it("returns undefined for the legacy generic \"1\" marker (no precise role available)", () => {
    expect(detectChildRole({ HARNESS_SUBAGENT: "1" })).toBeUndefined();
  });

  it("returns the live pi-subagents child agent name when present", () => {
    expect(detectChildRole({ PI_SUBAGENT_CHILD: "1", PI_SUBAGENT_CHILD_AGENT: "reviewer-security" })).toBe("reviewer-security");
  });

  it("prefers the legacy role name over a live child agent name if both are set", () => {
    expect(detectChildRole({ HARNESS_SUBAGENT: "reviewer", PI_SUBAGENT_CHILD_AGENT: "explore" })).toBe("reviewer");
  });

  it("returns undefined when PI_SUBAGENT_CHILD is \"1\" but no child agent name was set", () => {
    expect(detectChildRole({ PI_SUBAGENT_CHILD: "1" })).toBeUndefined();
  });
});
