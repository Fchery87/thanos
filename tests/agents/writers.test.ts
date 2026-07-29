import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  /**
   * `executeTask` always spawns a child, and `getPiInvocation` builds the command
   * from `process.argv[1]`. Under vitest that is vitest's own worker bundle
   * (`node_modules/vitest/dist/workers/forks.js`), so this test used to spawn a
   * second vitest worker with pi's CLI arguments and pass only if that foreign
   * process loaded its whole runtime and crashed inside vitest's 5s default
   * timeout. Measured at 233ms alone and 668ms under CPU saturation — enough
   * headroom most of the time, and not enough during a full-suite run, which is
   * what made it fail roughly one run in five with `Test timed out in 5000ms`.
   *
   * The assertions were never what failed: both the exit-code and signal paths of
   * `resolveFinalText` yield a contract with `status: "error"`, so the outcome
   * tracked process startup timing rather than any behaviour of this repo.
   *
   * Pointing `argv[1]` at a script that exits immediately keeps the real
   * `executeTask` path — worktree decision, prompt file, arg building, spawn,
   * contract parsing — while removing the megabyte of foreign module loading that
   * made the duration unpredictable. `execution.test.ts` overrides `argv[1]` the
   * same way. The explicit timeout is a backstop, not the fix.
   */
  it("read-only roles return a contract without a worktree", async () => {
    const originalCwd = process.cwd;
    const originalArgv1 = process.argv[1];
    // Also redirects the run's transcript metadata, which `executeTask` writes to
    // `<cwd>/.harness/subagents/` — this test used to leave it in the checkout.
    const repoDir = await mkdtemp(join(tmpdir(), "harness-readonly-"));
    const stubChild = join(repoDir, "immediate-exit.mjs");
    await writeFile(stubChild, "process.exit(1);\n", "utf-8");

    process.cwd = () => repoDir;
    process.argv[1] = stubChild;

    try {
      const result = await executeTask(
        { type: "explore", goal: "read-only task" },
        undefined,
        undefined,
      );

      expect(typeof result).toBe("string");
      const contract = parseSubagentResult(result);
      expect(contract.status).toBeDefined();
      // The claim in this test's name, which nothing here previously checked:
      // `createWorktree` writes to `<repoDir>/.harness/worktrees/<id>`, so for a
      // read-only role that directory must never come into existence.
      expect(existsSync(join(repoDir, ".harness", "worktrees"))).toBe(false);
    } finally {
      process.cwd = originalCwd;
      process.argv[1] = originalArgv1;
      await rm(repoDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);
});
