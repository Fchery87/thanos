import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// Mirrors scripts/patch-pi-subagents.mjs.
//
// `pi update` / `pi update --extensions` reinstall pi-subagents from npm, which
// replaces the whole package tree and wipes the Thanos patches even when the
// version is unchanged. That is the common case and it is not a code-shape
// break: the patches still apply verbatim, so making the operator run a script
// by hand buys nothing but a broken fanout tree in the meantime.
//
// So session startup self-heals, but only across the one boundary where
// re-applying is provably safe: the installed version is byte-identical to the
// version this repo pins in devDependencies, which is the version the patch
// artifact was cut against. Any other version is a real update whose patches may
// no longer describe the code — that stays a human decision and only warns.
export const PATCH_TARGETS = [
  { file: join("extension", "fanout-child.ts"), marker: "thanos-patch: process-global fanout tool guard" },
  { file: join("api", "delegation.ts"), marker: "thanos-patch: delegation evidence envelope types" },
  { file: join("slash", "delegation-request.ts"), marker: "thanos-patch: acceptance request validation" },
  { file: join("slash", "delegation-adapters.ts"), marker: "thanos-patch: evidence envelope projection" },
] as const;

export function defaultPiSubagentsSrcRoot(): string {
  return join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents", "src");
}

export function defaultThanosRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function defaultPatchScriptPath(thanosRoot: string = defaultThanosRoot()): string {
  return join(thanosRoot, "scripts", "patch-pi-subagents.mjs");
}

/** Version of the pi-subagents actually sitting in node_modules. */
export async function readInstalledPiSubagentsVersion(
  root: string = defaultPiSubagentsSrcRoot(),
): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(root, "..", "package.json"), "utf-8")) as { version?: string };
    return typeof manifest.version === "string" ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Version the patches were cut against. Read from devDependencies rather than
 * hardcoded so there is exactly one pin to bump; an exact pin (no ^ or ~) is
 * what makes the equality check below meaningful, and a range would silently
 * widen the auto-reapply window to versions nobody verified.
 */
export async function readPinnedPiSubagentsVersion(
  thanosRoot: string = defaultThanosRoot(),
): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(thanosRoot, "package.json"), "utf-8")) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const pin = manifest.devDependencies?.["pi-subagents"] ?? manifest.dependencies?.["pi-subagents"];
    return pin !== undefined && /^\d+\.\d+\.\d+$/.test(pin) ? pin : undefined;
  } catch {
    return undefined;
  }
}

export interface PatchDriftResult {
  installed: boolean;
  missingMarkers: string[];
}

export async function checkPatchDrift(root: string = defaultPiSubagentsSrcRoot()): Promise<PatchDriftResult> {
  if (!existsSync(root)) return { installed: false, missingMarkers: [] };

  const missingMarkers: string[] = [];
  for (const target of PATCH_TARGETS) {
    try {
      const contents = await readFile(join(root, target.file), "utf-8");
      if (!contents.includes(target.marker)) missingMarkers.push(target.marker);
    } catch {
      missingMarkers.push(target.marker);
    }
  }
  return { installed: true, missingMarkers };
}

export function formatPatchDriftWarning(
  result: PatchDriftResult,
  patchScriptPath: string = defaultPatchScriptPath(),
): string | undefined {
  if (!result.installed || result.missingMarkers.length === 0) return undefined;
  const list = result.missingMarkers.map((marker) => `  - ${marker}`).join("\n");
  return (
    `pi-subagents compatibility patches are missing (${result.missingMarkers.length}/${PATCH_TARGETS.length}):\n${list}\n` +
    `Apply at a controlled update boundary: node "${patchScriptPath}"`
  );
}

// A patch run rewrites files under node_modules; two sessions opening at once
// would otherwise race on the same tree. mkdir is atomic on every platform we
// target, so the directory itself is the lock, and acquisition is the single
// atomic syscall — there is deliberately no check-then-act path anywhere here.
//
// In particular a crashed holder is NOT reclaimed. Reclaiming means deciding a
// lock is stale and then removing it, and those are two steps: a second session
// that made the same decision can delete the fresh lock the first one just took
// (rm -rf does not check ownership) and both proceed. Renaming instead of
// removing only narrows that window, because the rename still acts on whatever
// occupies the path at that instant rather than the directory that was judged
// stale. Every variant trades a rare wedge for a rare double-run, and a
// double-run is the failure this lock exists to prevent.
//
// So a stale lock is surfaced instead of cleared: the caller turns it into a
// visible "run it yourself" warning. That is self-limiting rather than a
// permanent wedge — the manual run clears the drift, and a clean tree never
// reaches the lock again.
const LOCK_STALE_MS = 5 * 60_000;

type LockOutcome<T> = { kind: "held"; value: T } | { kind: "contended"; stale: boolean };

async function withPatchLock<T>(lockPath: string, run: () => Promise<T>): Promise<LockOutcome<T>> {
  try {
    await mkdir(lockPath);
  } catch {
    // Age is reported, never acted on. An unreadable lock is treated as live:
    // the conservative reading is that someone else is mid-run.
    const age = await stat(lockPath).then((held) => Date.now() - held.mtimeMs).catch(() => 0);
    return { kind: "contended", stale: age >= LOCK_STALE_MS };
  }
  try {
    return { kind: "held", value: await run() };
  } finally {
    await rm(lockPath, { recursive: true, force: true }).catch(() => {});
  }
}

export function defaultPatchLockPath(): string {
  return join(tmpdir(), "thanos-pi-subagents-patch.lock");
}

export type PatchReapplyResult =
  | { status: "not-installed" }
  | { status: "clean" }
  | { status: "busy" }
  | { status: "stale-lock"; lockPath: string; missingMarkers: string[] }
  | { status: "reapplied"; version: string; markers: string[] }
  | { status: "version-mismatch"; installed?: string; pinned?: string; missingMarkers: string[] }
  | { status: "failed"; detail: string; missingMarkers: string[] };

export interface ReapplyPatchesOptions {
  root?: string;
  thanosRoot?: string;
  lockPath?: string;
  /** Injectable so tests can exercise the decision logic without spawning node. */
  runPatchScript?: (scriptPath: string) => Promise<void>;
}

async function spawnPatchScript(scriptPath: string): Promise<void> {
  await execFileAsync(process.execPath, [scriptPath], { timeout: 120_000 });
}

/**
 * Self-heal reinstall drift, and only reinstall drift. Returns what happened so
 * the caller decides how loudly to say it.
 */
export async function reapplyPatchesIfVersionMatches(
  options: ReapplyPatchesOptions = {},
): Promise<PatchReapplyResult> {
  const root = options.root ?? defaultPiSubagentsSrcRoot();
  const thanosRoot = options.thanosRoot ?? defaultThanosRoot();

  const drift = await checkPatchDrift(root);
  if (!drift.installed) return { status: "not-installed" };
  if (drift.missingMarkers.length === 0) return { status: "clean" };

  const [installed, pinned] = await Promise.all([
    readInstalledPiSubagentsVersion(root),
    readPinnedPiSubagentsVersion(thanosRoot),
  ]);
  // Unknown counts as mismatch. An unreadable manifest is not evidence that the
  // versions agree, and the whole safety of auto-mutating node_modules rests on
  // that agreement being positively established.
  if (installed === undefined || pinned === undefined || installed !== pinned) {
    return { status: "version-mismatch", installed, pinned, missingMarkers: drift.missingMarkers };
  }

  const scriptPath = defaultPatchScriptPath(thanosRoot);
  if (!existsSync(scriptPath)) {
    return {
      status: "failed",
      detail: `patch script not found at ${scriptPath}`,
      missingMarkers: drift.missingMarkers,
    };
  }

  const lockPath = options.lockPath ?? defaultPatchLockPath();
  const outcome = await withPatchLock(
    lockPath,
    async (): Promise<PatchReapplyResult> => {
      try {
        await (options.runPatchScript ?? spawnPatchScript)(scriptPath);
      } catch (err) {
        return {
          status: "failed",
          detail: err instanceof Error ? err.message : String(err),
          missingMarkers: drift.missingMarkers,
        };
      }
      // Re-read the tree instead of trusting the exit code. The script exits 0
      // in its "patch no longer applies but behaviour is still correct" case,
      // which is exactly the case where markers stay absent and the operator
      // should be told — a retirement candidate, not a silent success.
      const after = await checkPatchDrift(root);
      if (after.missingMarkers.length > 0) {
        return {
          status: "failed",
          detail: "the patch script ran without error but the markers are still absent",
          missingMarkers: after.missingMarkers,
        };
      }
      return { status: "reapplied", version: installed, markers: drift.missingMarkers };
    },
  );

  if (outcome.kind === "held") return outcome.value;
  return outcome.stale
    ? { status: "stale-lock", lockPath, missingMarkers: drift.missingMarkers }
    : { status: "busy" };
}

export function formatReapplyNotice(
  result: PatchReapplyResult,
  patchScriptPath: string = defaultPatchScriptPath(),
): { message: string; level: "info" | "warning" } | undefined {
  switch (result.status) {
    // Nothing to say: no drift, no package, or another session is already on it.
    case "not-installed":
    case "clean":
    case "busy":
      return undefined;
    case "reapplied":
      return {
        level: "info",
        message:
          `Re-applied ${result.markers.length}/${PATCH_TARGETS.length} pi-subagents compatibility ` +
          `patches wiped by a reinstall of the pinned version (${result.version}).`,
      };
    case "version-mismatch": {
      const drift = formatPatchDriftWarning(
        { installed: true, missingMarkers: result.missingMarkers },
        patchScriptPath,
      );
      return {
        level: "warning",
        message:
          `${drift}\n` +
          `Not re-applied automatically: installed pi-subagents ${result.installed ?? "unknown"} ` +
          `does not match the pinned ${result.pinned ?? "unknown"} the patches were cut against.`,
      };
    }
    case "stale-lock":
      return {
        level: "warning",
        message:
          `pi-subagents compatibility patches are missing (${result.missingMarkers.length}/${PATCH_TARGETS.length}), ` +
          `but a previous patch run left a lock behind and appears to have crashed.\n` +
          `Not cleared automatically — removing a lock another session may still hold is how two runs end up ` +
          `rewriting node_modules at once.\n` +
          `Run manually: node "${patchScriptPath}"  (then remove "${result.lockPath}" if it persists)`,
      };
    case "failed":
      return {
        level: "warning",
        message:
          `Automatic re-apply of the pi-subagents compatibility patches failed: ${result.detail}\n` +
          `Run manually and review the output: node "${patchScriptPath}"`,
      };
  }
}
