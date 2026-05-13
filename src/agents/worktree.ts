import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

export interface Worktree {
  path: string;
  branch: string;
}

export function generateWorktreeId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

export async function createWorktree(repoDir: string, id: string): Promise<Worktree> {
  const worktreePath = path.join(repoDir, ".harness", "worktrees", id);
  const branch = `harness/wt-${id}`;
  await execFileAsync("git", ["-C", repoDir, "worktree", "add", worktreePath, "-b", branch]);
  return { path: worktreePath, branch };
}

export async function removeWorktree(repoDir: string, worktree: Worktree): Promise<void> {
  try {
    await execFileAsync("git", ["-C", repoDir, "worktree", "remove", worktree.path, "--force"]);
  } catch { /* best effort */ }
  try {
    await execFileAsync("git", ["-C", repoDir, "branch", "-D", worktree.branch]);
  } catch { /* best effort */ }
}
