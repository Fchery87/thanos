import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SNAPSHOT_MESSAGE = "harness: pre-critical snapshot";

export type SnapshotOutcome =
  | { state: "succeeded"; reference: string; limitations: string[] }
  | { state: "skipped"; reason: string; limitations: string[] }
  | { state: "failed"; reason: string; limitations: string[] };

/**
 * Record a recovery point without touching the working tree. Untracked-only
 * changes remain an explicit limitation because stash create cannot capture them.
 */
export async function createSnapshotOutcome(repoDir: string): Promise<SnapshotOutcome> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoDir, "status", "--porcelain"]);
    if (!stdout.trim()) {
      return { state: "skipped", reason: "working tree is clean", limitations: [] };
    }

    const { stdout: createOut } = await execFileAsync("git", ["-C", repoDir, "stash", "create"]);
    const commit = createOut.trim();
    if (!commit) {
      return {
        state: "skipped",
        reason: "changes are untracked-only and cannot be captured by stash create",
        limitations: ["untracked files are not included in the recovery point"],
      };
    }

    await execFileAsync("git", ["-C", repoDir, "stash", "store", "-m", SNAPSHOT_MESSAGE, commit]);
    return { state: "succeeded", reference: commit, limitations: ["untracked files are not included"] };
  } catch (error) {
    return {
      state: "failed",
      reason: error instanceof Error && error.message.trim() ? error.message.trim() : "git snapshot failed",
      limitations: ["no recovery point was recorded"],
    };
  }
}

/** Backward-compatible boolean helper for existing callers. */
export async function createSnapshot(repoDir: string): Promise<boolean> {
  return (await createSnapshotOutcome(repoDir)).state === "succeeded";
}
