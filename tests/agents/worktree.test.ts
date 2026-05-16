import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createWorktree, gcWorktrees, removeWorktree, generateWorktreeId } from "../../src/agents/worktree";

const exec = promisify(execFile);
const dirs: string[] = [];

async function initGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "harness-wt-test-"));
  dirs.push(dir);
  await exec("git", ["-C", dir, "init"]);
  await exec("git", ["-C", dir, "config", "user.email", "test@test.com"]);
  await exec("git", ["-C", dir, "config", "user.name", "Test"]);
  await exec("git", ["-C", dir, "commit", "--allow-empty", "-m", "init"]);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("createWorktree", () => {
  it("creates a worktree at .harness/worktrees/<id>", async () => {
    const repoDir = await initGitRepo();
    const wt = await createWorktree(repoDir, "abc12345");
    expect(wt.path).toBe(join(repoDir, ".harness", "worktrees", "abc12345"));
    expect(wt.branch).toBe("harness/wt-abc12345");
    expect(existsSync(wt.path)).toBe(true);
  });

  it("registers the branch in the parent repo", async () => {
    const repoDir = await initGitRepo();
    const wt = await createWorktree(repoDir, "def67890");
    const { stdout } = await exec("git", ["-C", repoDir, "branch", "--list", wt.branch]);
    expect(stdout).toContain(wt.branch);
  });

  it("creates independent worktrees with different IDs", async () => {
    const repoDir = await initGitRepo();
    const wt1 = await createWorktree(repoDir, "aaa00001");
    const wt2 = await createWorktree(repoDir, "bbb00002");
    expect(wt1.path).not.toBe(wt2.path);
    expect(existsSync(wt1.path)).toBe(true);
    expect(existsSync(wt2.path)).toBe(true);
  });
});

describe("removeWorktree", () => {
  it("removes the worktree directory", async () => {
    const repoDir = await initGitRepo();
    const wt = await createWorktree(repoDir, "rem12345");
    await removeWorktree(repoDir, wt);
    expect(existsSync(wt.path)).toBe(false);
  });

  it("removes the worktree branch", async () => {
    const repoDir = await initGitRepo();
    const wt = await createWorktree(repoDir, "brm12345");
    await removeWorktree(repoDir, wt);
    const { stdout } = await exec("git", ["-C", repoDir, "branch", "--list", wt.branch]);
    expect(stdout.trim()).toBe("");
  });

  it("is idempotent — does not throw if already removed", async () => {
    const repoDir = await initGitRepo();
    const wt = await createWorktree(repoDir, "idem1234");
    await removeWorktree(repoDir, wt);
    await expect(removeWorktree(repoDir, wt)).resolves.toBeUndefined();
  });
});

describe("generateWorktreeId", () => {
  it("returns an 8-character hex string", () => {
    const id = generateWorktreeId();
    expect(id).toMatch(/^[a-f0-9]{8}$/);
  });

  it("generates unique IDs across 20 calls", () => {
    const ids = new Set(Array.from({ length: 20 }, generateWorktreeId));
    expect(ids.size).toBe(20);
  });
});

describe("createWorktree — pid marker file", () => {
  it("writes .harness-pid containing process.pid to the worktree directory", async () => {
    const repoDir = await initGitRepo();
    const wt = await createWorktree(repoDir, "pid12345");
    const pidFile = join(wt.path, ".harness-pid");
    expect(existsSync(pidFile)).toBe(true);
    const contents = await readFile(pidFile, "utf-8");
    expect(contents.trim()).toBe(String(process.pid));
  });
});

describe("gcWorktrees", () => {
  it("removes worktrees whose pid file references a dead process", async () => {
    const repoDir = await initGitRepo();
    // Create a worktree and manually overwrite its pid file with a dead pid (1 is
    // always alive on Linux, so use a large unrealistic pid for a "dead" process)
    const wt = await createWorktree(repoDir, "gc000001");
    // Write a pid that is certainly not alive
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(wt.path, ".harness-pid"), "999999999", "utf-8");

    const removed = await gcWorktrees(repoDir);

    expect(removed.length).toBe(1);
    expect(removed[0]!.branch).toBe(wt.branch);
    expect(existsSync(wt.path)).toBe(false);
  });

  it("keeps worktrees whose pid is still alive (current process)", async () => {
    const repoDir = await initGitRepo();
    // createWorktree writes process.pid — this process is clearly alive
    const wt = await createWorktree(repoDir, "gc000002");

    const removed = await gcWorktrees(repoDir);

    expect(removed).toHaveLength(0);
    expect(existsSync(wt.path)).toBe(true);

    await removeWorktree(repoDir, wt); // cleanup
  });

  it("resolves to empty array when worktrees directory does not exist", async () => {
    const repoDir = await initGitRepo();
    // No .harness/worktrees dir — should not throw
    const removed = await gcWorktrees(repoDir);
    expect(removed).toEqual([]);
  });
});
