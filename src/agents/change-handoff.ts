import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ChangeHandoff {
  patch: string;
  baseCommit: string;
  changedPaths: string[];
  hasUntracked: boolean;
}

export type HandoffResult =
  | { kind: "ok"; handoff: ChangeHandoff; patchPath: string }
  | { kind: "no_changes" }
  | { kind: "failure"; reason: string };

export async function captureChanges(
  repoDir: string,
  worktreePath: string,
  scope?: string[],
): Promise<HandoffResult> {
  let baseCommit: string;
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoDir, "rev-parse", "HEAD"]);
    baseCommit = stdout.trim();
  } catch {
    return { kind: "failure", reason: "could not determine base commit" };
  }

  let diff: string;
  try {
    const { stdout } = await execFileAsync("git", ["-C", worktreePath, "diff", "--src-prefix=a/", "--dst-prefix=b/"]);
    diff = stdout;
  } catch {
    return { kind: "failure", reason: "could not capture diff" };
  }

  let untrackedDiff = "";
  try {
    const { stdout } = await execFileAsync("git", ["-C", worktreePath, "ls-files", "--others", "--exclude-standard", "-z"]);
    const untrackedFiles = stdout.split("\0").filter(Boolean);
    if (untrackedFiles.length > 0) {
      const parts: string[] = [];
      for (const file of untrackedFiles) {
        try {
          const content = await readFile(join(worktreePath, file), "utf-8");
          parts.push(`diff --git a/${file} b/${file}`);
          parts.push("new file mode 100644");
          parts.push(`--- /dev/null`);
          parts.push(`+++ b/${file}`);
          const lines = content.split("\n");
          parts.push(`@@ -0,0 +1,${lines.length} @@`);
          for (const l of lines) parts.push(`+${l}`);
        } catch {
          // skip unreadable files
        }
      }
      untrackedDiff = parts.join("\n");
    }
  } catch {
    // untracked files are non-critical
  }

  const patch = [diff, untrackedDiff].filter(Boolean).join("\n");
  if (patch.trim().length === 0) {
    return { kind: "no_changes" };
  }

  // Extract changed paths from the diff
  const changedPaths: string[] = [];
  const pathRe = /^diff --git [ab]\/(.*?) [ab]\/(.*?)$/gm;
  let match;
  while ((match = pathRe.exec(patch)) !== null) {
    const path = match[1];
    if (path && !changedPaths.includes(path)) {
      changedPaths.push(path);
    }
  }

  // Reject paths outside the assigned write scope
  if (scope && scope.length > 0) {
    for (const p of changedPaths) {
      const allowed = scope.some((s) => p.startsWith(s) || s === "*");
      if (!allowed) {
        return {
          kind: "failure",
          reason: `path "${p}" is outside the assigned write scope [${scope.join(", ")}]`,
        };
      }
    }
  }

  return {
    kind: "ok",
    handoff: { patch, baseCommit, changedPaths, hasUntracked: untrackedDiff.length > 0 },
    patchPath: "",
  };
}

export async function writeHandoffPatch(
  storeDir: string,
  runId: string,
  handoff: ChangeHandoff,
): Promise<string> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(storeDir, { recursive: true });
  const patchPath = join(storeDir, runId, "changes.patch");
  await writeFile(patchPath, handoff.patch, "utf-8");
  return patchPath;
}
