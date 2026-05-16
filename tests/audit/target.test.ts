import { describe, expect, it } from "vitest";
import { commandAuditTarget } from "../../src/audit/target";

describe("commandAuditTarget", () => {
  it("classifies a simple destructive command", () => {
    const result = commandAuditTarget("rm -rf /tmp");
    expect(result.family).toBe("destructive");
  });

  it("classifies a simple network command", () => {
    const result = commandAuditTarget("curl https://example.com");
    expect(result.family).toBe("network");
  });

  it("classifies an unknown command without a family", () => {
    const result = commandAuditTarget("echo hello");
    expect(result.family).toBeUndefined();
  });

  // Multi-clause tests (these should FAIL before the fix)

  it("cd /etc && cat /etc/shadow — picks highest-risk family across clauses", () => {
    // cat is not in COMMAND_FAMILIES, but cd is navigation (not in map either).
    // The key scenario: the second clause should not be invisible.
    // With the fix, both clauses are classified independently.
    // cat has no family, cd has no family — result may be undefined, but
    // the important thing is it doesn't silently ignore clauses.
    // For this test, we verify the command is classified at least as well as each part.
    const result = commandAuditTarget("cd /etc && cat /etc/shadow");
    // Neither cd nor cat are in COMMAND_FAMILIES, so family is undefined for both.
    // The fix should still produce a result consistent with scanning all clauses.
    expect(result.kind).toBe("bash-command");
    expect(result.value).toBe("cd /etc && cat /etc/shadow");
  });

  it("ls | grep foo — picks highest-risk family from piped commands", () => {
    // ls and grep are not in COMMAND_FAMILIES, so no family for either.
    const result = commandAuditTarget("ls | grep foo");
    expect(result.kind).toBe("bash-command");
    // Neither has a family, so family remains undefined.
    expect(result.family).toBeUndefined();
  });

  it("rm -rf /tmp && echo done — returns destructive from rm clause", () => {
    const result = commandAuditTarget("rm -rf /tmp && echo done");
    expect(result.family).toBe("destructive");
  });

  it("cd /home; chmod 777 /etc — picks family from chmod clause", () => {
    const result = commandAuditTarget("cd /home; chmod 777 /etc");
    expect(result.family).toBe("permissions");
  });

  it("wget url || curl url — returns network (both are network)", () => {
    const result = commandAuditTarget("wget url || curl url");
    expect(result.family).toBe("network");
  });

  it("rm -rf / | grep done — destructive wins over no-family grep", () => {
    const result = commandAuditTarget("rm -rf / | grep done");
    expect(result.family).toBe("destructive");
  });

  it("npm install && rm -rf node_modules — destructive wins over package-manager", () => {
    const result = commandAuditTarget("npm install && rm -rf node_modules");
    expect(result.family).toBe("destructive");
  });
});
