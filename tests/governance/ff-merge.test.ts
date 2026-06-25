import { execFile } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { fastForwardMerge, getCurrentBranch } from "../../src/governance/ff-merge";

const execFileAsync = promisify(execFile);

/** Run git in `dir`, returning trimmed stdout. */
async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args]);
  return stdout.trim();
}

/** Hash of a ref. */
async function rev(dir: string, ref: string): Promise<string> {
  return git(dir, "rev-parse", ref);
}

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "ffmerge-"));
  await git(repo, "init", "-q");
  // Configure identity so commits work regardless of host config.
  await git(repo, "config", "user.email", "test@example.com");
  await git(repo, "config", "user.name", "Test");
  // Explicitly name the default branch so we never depend on host defaults.
  await git(repo, "checkout", "-q", "-b", "main");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function commit(message: string, fileName: string, content: string): Promise<void> {
  await writeFile(path.join(repo, fileName), content, "utf-8");
  await git(repo, "add", "-A");
  await git(repo, "commit", "-q", "-m", message);
}

describe("fastForwardMerge", () => {
  it("fast-forwards the default branch when possible (A)", async () => {
    await commit("base", "a.txt", "1");
    // feature one commit ahead, main stays put.
    await git(repo, "checkout", "-q", "-b", "feature");
    await commit("feature work", "b.txt", "2");
    const featureHead = await rev(repo, "feature");

    // Move off feature so checkout in the helper is a real switch.
    await git(repo, "checkout", "-q", "feature");

    const result = await fastForwardMerge(repo, "feature", "main");

    expect(result.ok).toBe(true);
    expect(await rev(repo, "main")).toBe(featureHead);
    // Helper leaves us on the default branch.
    expect(await git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("refuses a non-fast-forward merge and leaves default unmoved (B)", async () => {
    await commit("base", "a.txt", "1");
    const base = await rev(repo, "main");

    // Diverge: main gets its own commit.
    await commit("main work", "main.txt", "m");
    const mainHead = await rev(repo, "main");

    // feature branches off the common base with its own commit.
    await git(repo, "checkout", "-q", "-b", "feature", base);
    await commit("feature work", "feature.txt", "f");

    const result = await fastForwardMerge(repo, "feature", "main");

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.reason?.length).toBeGreaterThan(0);
    // main must be untouched.
    expect(await rev(repo, "main")).toBe(mainHead);
  });

  it("returns a typed failure rather than throwing for a bogus branch", async () => {
    await commit("base", "a.txt", "1");
    const result = await fastForwardMerge(repo, "does-not-exist", "main");
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("succeeds (already up to date) when branch is an ancestor of default and leaves default unmoved", async () => {
    await commit("base", "a.txt", "1");
    // feature points at the base, then main moves ahead.
    await git(repo, "checkout", "-q", "-b", "feature");
    await git(repo, "checkout", "-q", "main");
    await commit("main ahead", "main.txt", "m");
    const mainHead = await rev(repo, "main");

    // feature is behind main → merging it is a no-op fast-forward.
    const result = await fastForwardMerge(repo, "feature", "main");

    expect(result.ok).toBe(true);
    // main pointer is unchanged ("Already up to date").
    expect(await rev(repo, "main")).toBe(mainHead);
  });

  it("returns a typed failure (no throw) when a dirty worktree blocks the merge", async () => {
    await commit("base", "a.txt", "1");
    // feature one commit ahead that touches a.txt, main stays put.
    await git(repo, "checkout", "-q", "-b", "feature");
    await commit("feature edits a.txt", "a.txt", "feature-content");
    const mainHead = await rev(repo, "main");

    // Back on main with a conflicting uncommitted change to the same file.
    await git(repo, "checkout", "-q", "main");
    await writeFile(path.join(repo, "a.txt"), "dirty-local-change", "utf-8");

    const result = await fastForwardMerge(repo, "feature", "main");

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.reason?.length).toBeGreaterThan(0);
    // main must be untouched.
    expect(await rev(repo, "main")).toBe(mainHead);
  });
});

describe("getCurrentBranch", () => {
  it("returns the current branch name", async () => {
    await commit("base", "a.txt", "1");
    expect(await getCurrentBranch(repo)).toBe("main");
  });

  it("returns null on error (not a git repo) instead of throwing", async () => {
    const notRepo = await mkdtemp(path.join(tmpdir(), "ffmerge-notrepo-"));
    try {
      expect(await getCurrentBranch(notRepo)).toBeNull();
    } finally {
      await rm(notRepo, { recursive: true, force: true });
    }
  });
});
