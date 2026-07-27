import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Repo-relative POSIX paths, the single spelling every path in the evidence plane
 * is stored in.
 *
 * Contract targets are guaranteed repo-relative by `contract-schema.ts`'s
 * VALID_TARGET, but evidence paths came straight from tool input, and pi's
 * edit/write schema declares `path` as "relative or absolute". `pathsMatchTargets`
 * compares by raw string, so an absolute path matched no target and the diff was
 * silently discarded — a gated criterion then failed for want of evidence that had
 * actually been produced.
 *
 * Normalizing at record time (rather than at compare time) means the canonical
 * path also reaches the audit log and the harness ledger, and keeps the verifier a
 * pure string comparison.
 */

function stripTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, "");
}

/** True when `relative()` walked out of the root instead of down into it. */
function escapesRoot(rel: string): boolean {
  return rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || isAbsolute(rel);
}

/**
 * A tool-supplied path as a repo-relative POSIX path, or `undefined` when it does
 * not describe a file inside the repo.
 *
 * Paths outside the root are dropped rather than recorded verbatim: contract
 * targets are always repo-relative, so such a path could never match one, and
 * keeping it would only put an unmatchable record in the evidence set.
 */
export function toRepoRelative(input: string, cwd = process.cwd()): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;

  const absolute = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  const rel = relative(cwd, absolute);
  if (rel.length === 0) return undefined; // the repo root itself is not a file
  if (escapesRoot(rel)) return undefined;

  return stripTrailingSlashes(rel.split(sep).join("/"));
}

/** Normalize a set of claimed paths, dropping duplicates and unusable entries. */
export function normalizeClaimedPaths(claimedPaths: string[], cwd = process.cwd()): string[] {
  const normalized = claimedPaths
    .map((path) => toRepoRelative(path, cwd))
    .filter((path): path is string => path !== undefined);
  return Array.from(new Set(normalized));
}
