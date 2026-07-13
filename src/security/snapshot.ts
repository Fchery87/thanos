import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SNAPSHOT_MESSAGE = "harness: pre-critical snapshot";

/**
 * Record a recovery point before a critical (mutating) tool call, without
 * touching the working tree. Uses `stash create` + `stash store` rather than
 * `stash push`: push resets the working tree to HEAD, which would destroy the
 * agent's in-progress edits right before the command it was meant to protect
 * runs. `stash create` only ever records a commit object; the tree is never
 * modified.
 *
 * Accepted limitation: `stash create` does not capture untracked files (only
 * tracked changes, staged or unstaged). Preserving work always wins over
 * capturing more of it — an untracked-only change reports `false` (nothing to
 * snapshot) but the file is never touched.
 */
export async function createSnapshot(repoDir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoDir, "status", "--porcelain"]);
    if (!stdout.trim()) return false;

    const { stdout: createOut } = await execFileAsync("git", ["-C", repoDir, "stash", "create"]);
    const commit = createOut.trim();
    if (!commit) return false; // nothing tracked to snapshot (e.g. untracked-only changes)

    await execFileAsync("git", ["-C", repoDir, "stash", "store", "-m", SNAPSHOT_MESSAGE, commit]);
    return true;
  } catch {
    return false;
  }
}
