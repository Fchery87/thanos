import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DiffEvidence } from "./claims";
import { normalizeClaimedPaths } from "./repo-paths";

export { normalizeClaimedPaths };

/**
 * Diff evidence from the working tree rather than from tool arguments.
 *
 * Recording an `edit`/`write` tool *input* as a diff is the working agent
 * certifying its own work: it says what the model asked for, not what landed. An
 * edit that partially applied, or that was reverted later in the same turn, still
 * read as satisfied. Git is the ground truth, and it also picks up a subagent's
 * edits — same working tree — without any agent-authored evidence record, which is
 * why this satisfies the outcome W4.2 wanted while respecting why it was deferred.
 *
 * Turn attribution comes from a baseline captured at turn start: a file already
 * dirty before the turn, and untouched during it, is not this turn's evidence.
 */

const execFileAsync = promisify(execFile);

/** Beyond this many changed files, skip hashing and let tool-input evidence stand. */
const MAX_CHANGED_FILES = 500;

/** Sentinel hash for a path git reports as changed but which cannot be read. */
const UNREADABLE = "<unreadable>";

/** Repo-root-relative path → content hash, for every path git considers dirty. */
export type WorkingTreeSnapshot = Map<string, string>;

/**
 * agent_end awaits this path before a turn can finish, so a hang here hangs the
 * turn. Every other failure mode degrades to undefined; without a timeout, a git
 * blocked on index.lock contention, a slow network filesystem, or a credential
 * prompt would not.
 */
const GIT_TIMEOUT_MS = 10_000;

/**
 * `--untracked-files=all` on a tree with a large un-ignored directory (a stray
 * node_modules) overflows the 1 MiB default, which would make git() return
 * undefined and evidence silently vanish — in exactly the large repos where
 * MAX_CHANGED_FILES was supposed to be the deciding guard.
 */
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/** Bound on concurrent file reads, so hashing a dirty tree is not one big spike. */
const HASH_CONCURRENCY = 16;

async function git(repoDir: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoDir, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout;
  } catch {
    return undefined;
  }
}

/**
 * Paths out of `git status --porcelain=v1 -z`. Rename and copy entries emit a
 * second NUL-separated field holding the source path, which must be consumed so it
 * is not mistaken for another entry.
 */
function parsePorcelain(stdout: string): string[] {
  const fields = stdout.split("\0").filter((field) => field.length > 0);
  const paths: string[] = [];

  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i] ?? "";
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (path.length > 0) paths.push(path);
    if (status.startsWith("R") || status.startsWith("C")) i += 1;
  }

  return paths;
}

async function hashFile(absolutePath: string): Promise<string> {
  try {
    const contents = await readFile(absolutePath);
    return createHash("sha256").update(contents).digest("hex").slice(0, 16);
  } catch {
    // Deleted, or unreadable. Either way it differs from any real content hash,
    // so a deletion during the turn still registers as a change.
    return UNREADABLE;
  }
}

/**
 * Content hashes for every dirty path, or `undefined` when git is unavailable, the
 * directory is not a repo, or the tree is too large to hash cheaply. `undefined`
 * always means "no ground truth available" and leaves tool-input evidence standing.
 */
export async function snapshotWorkingTree(repoDir: string = process.cwd()): Promise<WorkingTreeSnapshot | undefined> {
  const top = (await git(repoDir, ["rev-parse", "--show-toplevel"]))?.trim();
  if (!top) return undefined;

  const status = await git(repoDir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status === undefined) return undefined;

  const paths = parsePorcelain(status);
  if (paths.length > MAX_CHANGED_FILES) return undefined;

  // Chunked rather than one Promise.all over every path: up to MAX_CHANGED_FILES
  // whole files read into memory at once is a needless spike on a hot path.
  const snapshot: WorkingTreeSnapshot = new Map();
  for (let i = 0; i < paths.length; i += HASH_CONCURRENCY) {
    const chunk = paths.slice(i, i + HASH_CONCURRENCY);
    const hashes = await Promise.all(chunk.map((path) => hashFile(join(top, path))));
    chunk.forEach((path, index) => snapshot.set(path, hashes[index] ?? UNREADABLE));
  }

  return snapshot;
}

/**
 * What this turn actually changed: paths dirty now whose content differs from the
 * baseline, or which were not dirty at all when the turn began.
 *
 * A path reverted to its committed state during the turn drops out of `git status`
 * and is correctly absent. A path already dirty at turn start and left alone is
 * excluded by the hash comparison.
 */
export async function collectTurnDiffEvidence(
  repoDir: string = process.cwd(),
  baseline?: WorkingTreeSnapshot,
): Promise<DiffEvidence | undefined> {
  const top = (await git(repoDir, ["rev-parse", "--show-toplevel"]))?.trim();
  if (!top) return undefined;

  const current = await snapshotWorkingTree(repoDir);
  if (!current) return undefined;

  const changed: Array<[string, string]> = [];
  for (const [path, hash] of current) {
    if (baseline?.get(path) !== hash) changed.push([path, hash]);
  }
  if (changed.length === 0) return undefined;

  changed.sort(([a], [b]) => a.localeCompare(b));

  // Git reports repo-root-relative paths; evidence is stored relative to cwd, the
  // same base contract targets are matched against. When cwd is the repo root
  // these are identical; when it is a subdirectory, paths outside it drop out —
  // matching how tool-input paths outside cwd are already handled.
  // git reports paths under the RESOLVED toplevel. If repoDir reaches us through
  // a symlink, comparing against it unresolved makes every joined path look like
  // it escapes the root, and all evidence is dropped.
  const resolvedRepoDir = await realpath(repoDir).catch(() => repoDir);
  const paths = normalizeClaimedPaths(changed.map(([path]) => join(top, path)), resolvedRepoDir);
  if (paths.length === 0) return undefined;

  const patchHash = createHash("sha256")
    .update(changed.map(([path, hash]) => `${path}:${hash}`).join("\n"))
    .digest("hex")
    .slice(0, 16);

  const base = (await git(repoDir, ["rev-parse", "HEAD"]))?.trim() ?? "";

  return { kind: "diff", paths, base, patchHash, passed: true };
}
