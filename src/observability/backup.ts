// src/observability/backup.ts
//
// Central helper for writers that snapshot a config/state file before
// overwriting it (or before discarding a corrupted copy). Every backup lands
// under a single `.harness/backups/` directory instead of scattering
// `<file>.bak` / `<file>.bak-<stamp>` siblings next to the live file.
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/**
 * Build the destination path for a one-off backup of `name`.
 *
 * The filename carries both a millisecond timestamp AND a short random nonce.
 * The timestamp alone is not collision-safe: two backups of the same file in
 * the same millisecond (or with a coarse clock) would compute identical paths,
 * and `copyFile`/`copyFileSync` overwrite the destination — silently dropping
 * a prior backup. The nonce makes each call's path unique regardless of clock
 * resolution, so no backup is ever clobbered by another.
 *
 * Callers are responsible for creating the parent directory (recursive
 * `mkdir`) before copying into the returned path — this function only
 * computes the path.
 *
 * @param name - the original file's basename (e.g. "models.json" or
 *   "mcp-secrets.json"), not a full path.
 * @param cwd - base directory the `.harness/` folder lives under; defaults
 *   to the current working directory, matching the rest of the harness's
 *   `.harness/*` conventions (see observability/harness-ledger.ts).
 * @returns a path of the form `<cwd>/.harness/backups/<name>.<ISO>.<nonce>.bak`,
 *   where `<ISO>` is the current timestamp with `:` and `.` replaced by `-`
 *   so it is safe to use in a filename, and `<nonce>` is 8 random hex chars.
 */
export function backupPath(name: string, cwd = process.cwd()): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = randomBytes(4).toString("hex");
  return join(cwd, ".harness", "backups", `${name}.${stamp}.${nonce}.bak`);
}
