import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
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
  await fsp.writeFile(path.join(worktreePath, ".harness-pid"), String(process.pid), "utf-8");
  return { path: worktreePath, branch };
}

/** Walk `.harness/worktrees/`, remove entries whose pid file references a dead process. */
export async function gcWorktrees(repoDir: string): Promise<Worktree[]> {
  const wtDir = path.join(repoDir, ".harness", "worktrees");
  let entries: string[];
  try {
    entries = await fsp.readdir(wtDir);
  } catch {
    return [];
  }

  const removed: Worktree[] = [];
  for (const entry of entries) {
    const wtPath = path.join(wtDir, entry);
    const branch = `harness/wt-${entry}`;
    const pidFile = path.join(wtPath, ".harness-pid");
    let pid: number | undefined;
    try {
      const raw = await fsp.readFile(pidFile, "utf-8");
      pid = parseInt(raw.trim(), 10);
    } catch {
      pid = undefined;
    }

    const isDead = pid === undefined || !isProcessAlive(pid);
    if (isDead) {
      const wt: Worktree = { path: wtPath, branch };
      try {
        await removeWorktree(repoDir, wt);
        removed.push(wt);
      } catch (err) {
        console.error(`[harness][worktree gc] Failed to remove ${wtPath}:`, err instanceof Error ? err.message : String(err));
      }
    }
  }
  return removed;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function removeWorktree(repoDir: string, worktree: Worktree): Promise<void> {
  try {
    await execFileAsync("git", ["-C", repoDir, "worktree", "remove", worktree.path, "--force"]);
  } catch { /* best effort */ }
  try {
    await execFileAsync("git", ["-C", repoDir, "branch", "-D", worktree.branch]);
  } catch { /* best effort */ }
}
