// src/observability/backup.ts
//
// Central helper for writers that snapshot a config/state file before
// overwriting it (or before discarding a corrupted copy). Every backup lands
// under a single `.harness/backups/` directory instead of scattering
// `<file>.bak` / `<file>.bak-<stamp>` siblings next to the live file.
import { join } from "node:path";

/**
 * Build the destination path for a one-off backup of `name`, timestamped so
 * repeat backups never collide.
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
 * @returns a path of the form `<cwd>/.harness/backups/<name>.<ISO>.bak`,
 *   where `<ISO>` is the current timestamp with `:` and `.` replaced by `-`
 *   so it is safe to use in a filename.
 */
export function backupPath(name: string, cwd = process.cwd()): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(cwd, ".harness", "backups", `${name}.${stamp}.bak`);
}
