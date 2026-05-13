import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createSnapshot } from "../../src/security/snapshot";

const exec = promisify(execFile);
const dirs: string[] = [];

async function initGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "harness-snap-test-"));
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

describe("createSnapshot", () => {
  it("returns false when there are no uncommitted changes", async () => {
    const repoDir = await initGitRepo();
    const created = await createSnapshot(repoDir);
    expect(created).toBe(false);
  });

  it("returns true and creates a stash entry when there are unstaged changes", async () => {
    const repoDir = await initGitRepo();
    await writeFile(join(repoDir, "dirty.ts"), "const x = 1;", "utf-8");
    await exec("git", ["-C", repoDir, "add", "dirty.ts"]);

    const created = await createSnapshot(repoDir);
    expect(created).toBe(true);

    const { stdout } = await exec("git", ["-C", repoDir, "stash", "list"]);
    expect(stdout).toContain("harness: pre-critical snapshot");
  });

  it("snapshot removes untracked file from working tree", async () => {
    const repoDir = await initGitRepo();
    const filePath = join(repoDir, "secret.txt");
    writeFileSync(filePath, "api_key=abc");

    await createSnapshot(repoDir);
    expect(existsSync(filePath)).toBe(false);
  });

  it("is safe to call in a non-git directory — returns false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "harness-nogit-"));
    dirs.push(dir);
    const created = await createSnapshot(dir);
    expect(created).toBe(false);
  });

  it("is idempotent — calling twice on a clean repo stays false", async () => {
    const repoDir = await initGitRepo();
    expect(await createSnapshot(repoDir)).toBe(false);
    expect(await createSnapshot(repoDir)).toBe(false);
  });
});
