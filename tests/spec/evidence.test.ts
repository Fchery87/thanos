import { describe, expect, it } from "vitest";
import { evidenceFromToolResult } from "../../src/spec/evidence";

describe("evidenceFromToolResult", () => {
  it("returns undefined for non-evidence tools (ask, report_finding)", () => {
    expect(evidenceFromToolResult({
      toolName: "ask",
      content: [{ type: "text", text: "some question" }],
    })).toBeUndefined();

    expect(evidenceFromToolResult({
      toolName: "report_finding",
      content: [{ type: "text", text: "P1: Policy bypass" }],
    })).toBeUndefined();
  });

  it("classifies test runners correctly (not substring match)", () => {
    const ev = evidenceFromToolResult({
      toolName: "bash",
      input: { command: "vitest run --coverage" },
    });
    expect(ev?.kind).toBe("test");
    if (ev?.kind === "test") {
      expect(ev.runner).toBe("vitest");
    }
  });

  it("classifies non-test bash as command evidence", () => {
    const ev = evidenceFromToolResult({
      toolName: "bash",
      input: { command: "ls -la" },
    });
    expect(ev?.kind).toBe("command");
  });

  it("does not classify printf test as test evidence", () => {
    const ev = evidenceFromToolResult({
      toolName: "bash",
      input: { command: "printf test passed" },
    });
    expect(ev?.kind).toBe("command");
  });

  it("classifies edit/write as diff evidence", () => {
    const ev = evidenceFromToolResult({
      toolName: "edit",
      input: { file_path: "src/foo.ts" },
    });
    expect(ev?.kind).toBe("diff");
    if (ev?.kind === "diff") {
      expect(ev.paths).toContain("src/foo.ts");
    }
  });

  it("returns undefined for bash with no command", () => {
    expect(evidenceFromToolResult({
      toolName: "bash",
      input: {},
    })).toBeUndefined();
  });

  it("treats git grep vitest as command (not test)", () => {
    const ev = evidenceFromToolResult({
      toolName: "bash",
      input: { command: "git grep vitest" },
    });
    expect(ev?.kind).toBe("command");
  });
});
