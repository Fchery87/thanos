import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createSnapshot(repoDir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoDir, "status", "--porcelain"]);
    if (!stdout.trim()) return false;
    await execFileAsync("git", [
      "-C", repoDir,
      "stash", "push",
      "--include-untracked",
      "-m", "harness: pre-critical snapshot",
    ]);
    return true;
  } catch {
    return false;
  }
}
