import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createSnapshot, SNAPSHOT_MESSAGE } from "../../src/security/snapshot";

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

  it("returns true, records a stash entry, and preserves staged tracked changes in the working tree", async () => {
    const repoDir = await initGitRepo();
    const filePath = join(repoDir, "dirty.ts");
    await writeFile(filePath, "const x = 1;", "utf-8");
    await exec("git", ["-C", repoDir, "add", "dirty.ts"]);

    const created = await createSnapshot(repoDir);
    expect(created).toBe(true);

    const { stdout } = await exec("git", ["-C", repoDir, "stash", "list"]);
    expect(stdout).toContain(SNAPSHOT_MESSAGE);

    // The whole point of a snapshot (as opposed to a destructive stash) is
    // that the working tree is left exactly as it was.
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("const x = 1;");
  });

  it("preserves unstaged tracked changes in the working tree", async () => {
    const repoDir = await initGitRepo();
    const filePath = join(repoDir, "tracked.ts");
    await writeFile(filePath, "const original = 1;", "utf-8");
    await exec("git", ["-C", repoDir, "add", "tracked.ts"]);
    await exec("git", ["-C", repoDir, "commit", "-m", "add tracked.ts"]);
    await writeFile(filePath, "const modified = 2;", "utf-8");

    const created = await createSnapshot(repoDir);
    expect(created).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("const modified = 2;");
  });

  it("does not capture untracked files (accepted limitation) and never removes them", async () => {
    const repoDir = await initGitRepo();
    const filePath = join(repoDir, "secret.txt");
    writeFileSync(filePath, "api_key=abc");

    // git stash create ignores untracked files entirely, so there is nothing
    // tracked to snapshot here — but the important invariant is that the file
    // is never touched, unlike the old `stash push --include-untracked`
    // behavior which removed it from the working tree.
    const created = await createSnapshot(repoDir);
    expect(created).toBe(false);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("api_key=abc");
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

  it("can snapshot repeatedly across successive dirty states without erroring", async () => {
    const repoDir = await initGitRepo();
    const filePath = join(repoDir, "dirty.ts");
    await writeFile(filePath, "const x = 1;", "utf-8");
    await exec("git", ["-C", repoDir, "add", "dirty.ts"]);
    expect(await createSnapshot(repoDir)).toBe(true);

    await writeFile(filePath, "const x = 2;", "utf-8");
    expect(await createSnapshot(repoDir)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("const x = 2;");

    const { stdout } = await exec("git", ["-C", repoDir, "stash", "list"]);
    expect(stdout.trim().split("\n").length).toBe(2);
  });
});
