import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The Thanos install root (~/.pi), independent of the session cwd — same
// technique as update-check.ts, whose cache this one sits beside.
const installRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const REPAIR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Mirrors scripts/patch-pi-subagents.mjs's `patches` list — keep both in sync
// if a patch is added, retired, or its marker string changes. Duplicated
// rather than imported: that script runs standalone via `node` outside the
// tsc/eslint project (see tsconfig.json's `include`), so cross-importing it
// into src/ would need allowJs and a build-time coupling neither side wants.
// tests/welcome/patch-drift.test.ts cross-checks both files' text stay in
// sync so this duplication can't silently drift.
export const PATCH_TARGETS = [
  { file: join("extension", "fanout-child.ts"), marker: "thanos-patch: process-global fanout tool guard" },
] as const;

/** Where pi-subagents installs, regardless of where this Thanos checkout lives. */
export function defaultPiSubagentsSrcRoot(): string {
  return join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents", "src");
}

// This Thanos checkout's own root — same technique as update-check.ts's
// installRoot — so the printed recovery command is correct for a custom
// install directory (scripts/install.sh --dir / THANOS_DIR), not just the
// ~/.pi default.
function defaultPatchScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "patch-pi-subagents.mjs");
}

export interface PatchDriftResult {
  /** False when the pi-subagents src root does not exist at all. */
  installed: boolean;
  /** Marker strings not found in their target file; empty when nothing is missing. */
  missingMarkers: string[];
}

/**
 * Checks whether every Thanos patch is still present in the installed
 * pi-subagents package. Never throws. A patch target file that is missing
 * entirely (e.g. an upstream restructure) counts as a missing marker too —
 * the patch cannot be confirmed applied, so this fails toward surfacing it
 * rather than silently trusting an unconfirmed state.
 */
export async function checkPatchDrift(root: string = defaultPiSubagentsSrcRoot()): Promise<PatchDriftResult> {
  if (!existsSync(root)) return { installed: false, missingMarkers: [] };

  const missingMarkers: string[] = [];
  for (const target of PATCH_TARGETS) {
    let contents: string;
    try {
      contents = await readFile(join(root, target.file), "utf-8");
    } catch {
      missingMarkers.push(target.marker);
      continue;
    }
    if (!contents.includes(target.marker)) missingMarkers.push(target.marker);
  }
  return { installed: true, missingMarkers };
}

export interface PatchRepairResult {
  /** True when a re-run left every marker present. */
  repaired: boolean;
  /** Markers still missing after the attempt; empty on success. */
  stillMissing: string[];
  /**
   * True when markers are still missing but the patch script exited 0, meaning
   * its behavioural probe confirmed pi-subagents is healthy without our patch —
   * upstream absorbed the fix. Benign: the patch is a retirement candidate, not
   * a regression.
   */
  benign?: boolean;
  /** Why the attempt could not run or did not finish, when it failed. */
  reason?: string;
}

/**
 * Re-applies drifted patches by re-running scripts/patch-pi-subagents.mjs.
 *
 * Spawning the script rather than reimplementing it here is deliberate: the
 * needle/replacement bodies stay single-sourced in the script, so repair can
 * never drift from what a manual re-run would do. The script is idempotent and
 * only writes when it finds its anchor, so running it against an already-patched
 * or upstream-changed tree is a no-op.
 *
 * This exists because the patch lives in node_modules, which `pi update` wipes.
 * Recovery used to depend on a hand-written `pi()` shell function that existed
 * on exactly one machine; a fresh install had no such safety net and the first
 * symptom of the missing fanout guard is nested runs dying with exit 1, which
 * reads like a model or network fault rather than a reverted patch.
 *
 * Never throws — a failed repair degrades to the warning path.
 */
export async function repairPatchDrift(
  root: string = defaultPiSubagentsSrcRoot(),
  patchScriptPath: string = defaultPatchScriptPath(),
): Promise<PatchRepairResult> {
  if (!existsSync(patchScriptPath)) {
    // Re-derive rather than reporting []: the caller renders "N/M missing" from
    // stillMissing, and an empty list here produced a self-contradictory "(0/1)"
    // warning that named no markers at all.
    const current = await checkPatchDrift(root);
    return {
      repaired: false,
      stillMissing: current.missingMarkers,
      reason: `patch script not found at ${patchScriptPath}`,
    };
  }
  let exitedClean = true;
  let reason: string | undefined;
  try {
    await execFileAsync(process.execPath, [patchScriptPath], { timeout: 30_000 });
  } catch (error) {
    exitedClean = false;
    reason = error instanceof Error ? error.message : String(error);
  }

  // The tree decides success, not the exit code — a run can exit non-zero for
  // reasons unrelated to whether this patch landed.
  const after = await checkPatchDrift(root);
  if (after.missingMarkers.length === 0) return { repaired: true, stillMissing: [] };

  // Markers still missing but the script exited 0: its behavioural probe passed,
  // so pi-subagents is healthy and the patch is simply obsolete. Without this
  // branch every subsequent session would re-run the repair and warn again
  // forever — reintroducing exactly the false alarm this work removed.
  if (exitedClean) return { repaired: false, stillMissing: after.missingMarkers, benign: true };

  return { repaired: false, stillMissing: after.missingMarkers, reason };
}

interface BenignRepairCache {
  checkedAt: number;
  /** pi-subagents version the verdict was observed for; null when unreadable. */
  version: string | null;
  /** The missing markers judged benign, sorted so order can't cause a false miss. */
  markers: string[];
}

/** Reads the installed pi-subagents version; null when unreadable. */
async function readPiSubagentsVersion(root: string): Promise<string | null> {
  try {
    const raw = await readFile(join(root, "..", "package.json"), "utf-8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

function sameMarkers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((marker, i) => marker === b[i]);
}

export interface CachedRepairOptions {
  root?: string;
  patchScriptPath?: string;
  cachePath?: string;
  ttlMs?: number;
  now?: number;
  repair?: (root: string, patchScriptPath: string) => Promise<PatchRepairResult>;
}

/**
 * `repairPatchDrift` with the benign verdict memoised on disk.
 *
 * A permanently obsolete patch is the pathological case: its marker can never be
 * restored, so an uncached caller re-spawns the whole chain (node → bun → temp
 * dir, ~2.8s) on every new session, forever, to re-derive an answer that cannot
 * change. Only the benign verdict is cached. A genuine repair failure keeps
 * retrying and warning every session, which is the point — it is actionable, and
 * it can legitimately start succeeding (bun installed later, upstream re-fixed).
 *
 * Keyed on the pi-subagents version and the exact missing-marker set, so a
 * package update or a different kind of drift re-runs the real check. The TTL is
 * a backstop for anything that changes the tree without changing the version.
 *
 * Never throws; a cache that cannot be read or written degrades to running the
 * real repair.
 */
export async function repairPatchDriftCached(
  missingMarkers: readonly string[],
  options: CachedRepairOptions = {},
): Promise<PatchRepairResult> {
  const {
    root = defaultPiSubagentsSrcRoot(),
    patchScriptPath = defaultPatchScriptPath(),
    cachePath = join(installRoot, ".harness", "patch-repair.json"),
    ttlMs = REPAIR_CACHE_TTL_MS,
    now = Date.now(),
    repair = repairPatchDrift,
  } = options;

  const markers = [...missingMarkers].sort();
  const version = await readPiSubagentsVersion(root);

  try {
    const cache = JSON.parse(await readFile(cachePath, "utf-8")) as BenignRepairCache;
    if (
      typeof cache.checkedAt === "number" &&
      now - cache.checkedAt < ttlMs &&
      cache.version === version &&
      Array.isArray(cache.markers) &&
      sameMarkers(cache.markers, markers)
    ) {
      return { repaired: false, stillMissing: [...missingMarkers], benign: true };
    }
  } catch { /* no cache yet, or unreadable */ }

  const result = await repair(root, patchScriptPath);

  if (result.benign) {
    try {
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(
        cachePath,
        JSON.stringify({ checkedAt: now, version, markers } satisfies BenignRepairCache),
        "utf-8",
      );
    } catch { /* cache write is best-effort */ }
  }

  return result;
}

/** Composes the session-start notice after an automatic repair attempt. */
export function formatPatchRepairNotice(
  before: PatchDriftResult,
  repair: PatchRepairResult,
  patchScriptPath: string = defaultPatchScriptPath(),
): { message: string; level: "info" | "warning" } | undefined {
  if (!before.installed || before.missingMarkers.length === 0) return undefined;
  // Obsolete-but-healthy is deliberately silent here. It is real information,
  // but it is not actionable mid-session and it would recur every single start.
  // The patch script surfaces it at `pi update` time instead, which is both the
  // moment it changed and the moment someone can act on it.
  if (repair.benign) return undefined;
  if (repair.repaired) {
    return {
      message:
        `pi-subagents patches were reverted by a package update and have been re-applied automatically ` +
        `(${before.missingMarkers.length}/${PATCH_TARGETS.length}).`,
      level: "info",
    };
  }
  const list = repair.stillMissing.map((m) => `  - ${m}`).join("\n");
  return {
    message:
      `pi-subagents patches are missing and could not be re-applied automatically ` +
      `(${repair.stillMissing.length}/${PATCH_TARGETS.length}):\n${list}\n` +
      (repair.reason ? `Reason: ${repair.reason}\n` : "") +
      `Run manually: node "${patchScriptPath}"`,
    level: "warning",
  };
}

/** Composes the session-start warning; undefined when there is nothing to report. */
export function formatPatchDriftWarning(
  result: PatchDriftResult,
  patchScriptPath: string = defaultPatchScriptPath(),
): string | undefined {
  if (!result.installed || result.missingMarkers.length === 0) return undefined;
  const list = result.missingMarkers.map((m) => `  - ${m}`).join("\n");
  return (
    `pi-subagents patches are missing after an update (${result.missingMarkers.length}/${PATCH_TARGETS.length}):\n${list}\n` +
    `Re-run: node "${patchScriptPath}"`
  );
}
