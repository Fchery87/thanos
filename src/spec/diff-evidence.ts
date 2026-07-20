import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { DiffEvidence } from "./claims";

const execFileAsync = promisify(execFile);

export async function validateDiffEvidence(
  repoDir: string,
  evidence: { filePath?: string; claimedPaths: string[] },
): Promise<DiffEvidence | undefined> {
  let diff: string;
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoDir, "diff", "HEAD", "--src-prefix=a/", "--dst-prefix=b/"]);
    diff = stdout;
  } catch {
    return undefined;
  }

  let untrackedDiff = "";
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoDir, "ls-files", "--others", "--exclude-standard", "-z"]);
    const untrackedFiles = stdout.split("\0").filter(Boolean);
    if (untrackedFiles.length > 0) {
      const parts: string[] = [];
      for (const file of untrackedFiles) {
        try {
          const { readFile } = await import("node:fs/promises");
          const { join } = await import("node:path");
          const content = await readFile(join(repoDir, file), "utf-8");
          parts.push(`diff --git a/${file} b/${file}`);
          parts.push("new file mode 100644");
          parts.push("--- /dev/null");
          parts.push(`+++ b/${file}`);
          const lines = content.split("\n");
          parts.push(`@@ -0,0 +1,${lines.length} @@`);
          for (const l of lines) parts.push(`+${l}`);
        } catch {
          // skip unreadable
        }
      }
      untrackedDiff = parts.join("\n");
    }
  } catch {
    // best effort
  }

  const fullDiff = [diff, untrackedDiff].filter(Boolean).join("\n");
  if (fullDiff.trim().length === 0) return undefined;

  const pathRe = /^diff --git [ab]\/(.*?) [ab]\/(.*?)$/gm;
  const actualPaths: string[] = [];
  let match;
  while ((match = pathRe.exec(fullDiff)) !== null) {
    const path = match[1];
    if (path && !actualPaths.includes(path)) actualPaths.push(path);
  }

  const patchHash = createHash("sha256").update(fullDiff).digest("hex").slice(0, 16);

  let base = "";
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoDir, "rev-parse", "HEAD"]);
    base = stdout.trim();
  } catch {
    // detached or no commits
  }

  // Check if any claimed path intersects with actual changes
  const hasRelevantChange = evidence.claimedPaths.length === 0
    || evidence.claimedPaths.some((claimed) =>
      actualPaths.some((actual) => actual === claimed || actual.startsWith(claimed + "/")),
    );

  if (!hasRelevantChange) return undefined;

  return {
    kind: "diff",
    paths: actualPaths,
    base,
    patchHash,
    passed: actualPaths.length > 0,
  };
}
