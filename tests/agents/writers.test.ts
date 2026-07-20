import { describe, expect, it } from "vitest";
import { agentWrites } from "../../src/agents/policy";
import { executeTask } from "../../src/agents/task-tool";
import { parseSubagentResult } from "../../src/agents/result";

describe("agentWrites", () => {
  it("returns true for writing agents", () => {
    expect(agentWrites("build")).toBe(true);
    expect(agentWrites("designer")).toBe(true);
  });

  it("returns false for read-only agents", () => {
    expect(agentWrites("explore")).toBe(false);
    expect(agentWrites("plan")).toBe(false);
    expect(agentWrites("reviewer")).toBe(false);
    expect(agentWrites("oracle")).toBe(false);
    expect(agentWrites("researcher")).toBe(false);
  });

  it("returns false for evaluator (may exec but never writes, so no worktree)", () => {
    expect(agentWrites("evaluator")).toBe(false);
  });
});

describe("writer isolation fail-closed", () => {
  it("returns a structured error contract when worktree creation fails", async () => {
    const originalCwd = process.cwd;
    const invalidCwd = "/nonexistent/path/for/worktree/failure/test";
    process.cwd = () => invalidCwd;

    try {
      const result = await executeTask(
        { type: "build", goal: "test task" },
        undefined,
        undefined,
      );

      const contract = parseSubagentResult(result);
      expect(contract.status).toBe("error");
      expect(contract.summary).toContain("worktree creation failed");
      expect(contract.metadata?.errorKind).toBe("worktree_creation_failed");
    } finally {
      process.cwd = originalCwd;
    }
  });

  it("does not expose raw parent checkout path in the error", async () => {
    const originalCwd = process.cwd;
    const invalidCwd = "/nonexistent/path/for/worktree/failure/test";
    process.cwd = () => invalidCwd;

    try {
      const result = await executeTask(
        { type: "build", goal: "test task" },
        undefined,
        undefined,
      );

      const contract = parseSubagentResult(result);
      expect(contract.summary).not.toContain(invalidCwd);
    } finally {
      process.cwd = originalCwd;
    }
  });

  it("read-only roles return a contract without a worktree", async () => {
    const result = await executeTask(
      { type: "explore", goal: "read-only task" },
      undefined,
      undefined,
    );

    expect(typeof result).toBe("string");
    // Read-only agents should not trigger worktree creation and should return
    // some result (even if from a child process that fails)
    const contract = parseSubagentResult(result);
    expect(contract.status).toBeDefined();
  });
});
