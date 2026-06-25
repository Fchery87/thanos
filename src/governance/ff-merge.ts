import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FfMergeResult {
  ok: boolean;
  reason?: string;
}

/**
 * Fast-forward-only merge of `branch` into the LOCAL `defaultBranch`.
 *
 * Checks out `defaultBranch`, then runs `git merge --ff-only <branch>`. If the
 * merge would not be a fast-forward (the branches have diverged), git exits
 * non-zero and we return `{ ok: false, reason }`. This NEVER force-merges and
 * NEVER pushes — it only advances the local default branch pointer.
 *
 * Every git failure is caught and returned as a typed result; this never throws.
 */
export async function fastForwardMerge(
  repoDir: string,
  branch: string,
  defaultBranch: string,
): Promise<FfMergeResult> {
  try {
    await execFileAsync("git", ["-C", repoDir, "checkout", defaultBranch]);
  } catch (err) {
    return { ok: false, reason: gitError(err, `failed to check out ${defaultBranch}`) };
  }

  try {
    await execFileAsync("git", ["-C", repoDir, "merge", "--ff-only", branch]);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: gitError(err, `cannot fast-forward ${defaultBranch} to ${branch}`) };
  }
}

/**
 * Best-effort current branch name (`git rev-parse --abbrev-ref HEAD`).
 * Returns null on any failure (detached HEAD, not a repo, …); never throws.
 */
export async function getCurrentBranch(repoDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD",
    ]);
    const branch = stdout.trim();
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

/** Extract a useful message from an execFile error (prefer git's stderr). */
function gitError(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { stderr?: unknown; message?: unknown };
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    if (stderr.length > 0) return stderr;
    if (typeof e.message === "string" && e.message.trim().length > 0) return e.message.trim();
  }
  return fallback;
}
