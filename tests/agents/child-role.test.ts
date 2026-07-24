import { describe, expect, it } from "vitest";
import { detectChildRole, isSubagentProcess } from "../../src/agents/child-role";

describe("isSubagentProcess", () => {
  it("is false for the main session (no subagent env vars set)", () => {
    expect(isSubagentProcess({})).toBe(false);
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

  it("returns the live pi-subagents child agent name when present", () => {
    expect(detectChildRole({ PI_SUBAGENT_CHILD: "1", PI_SUBAGENT_CHILD_AGENT: "reviewer-security" })).toBe("reviewer-security");
  });

  it("returns undefined when PI_SUBAGENT_CHILD is \"1\" but no child agent name was set", () => {
    expect(detectChildRole({ PI_SUBAGENT_CHILD: "1" })).toBeUndefined();
  });
});
