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
  { file: join("api", "delegation.ts"), marker: "thanos-patch: V2 evidence envelope types" },
  { file: join("slash", "delegation-request.ts"), marker: "thanos-patch: V2 acceptance request validation" },
  { file: join("slash", "delegation-adapters.ts"), marker: "thanos-patch: V2 evidence envelope projection" },
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
// target, so the directory itself is the lock. Losing the race is not an error —
// the winner is fixing the same tree — so the loser stays silent.
const LOCK_STALE_MS = 5 * 60_000;

async function withPatchLock<T>(lockPath: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    await mkdir(lockPath);
  } catch {
    // A lock older than any plausible patch run belongs to a crashed holder.
    // Reclaim it rather than wedging every future session behind a directory
    // that nobody is left alive to remove.
    try {
      const held = await stat(lockPath);
      if (Date.now() - held.mtimeMs < LOCK_STALE_MS) return undefined;
      await rm(lockPath, { recursive: true, force: true });
      await mkdir(lockPath);
    } catch {
      return undefined;
    }
  }
  try {
    return await run();
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

  const outcome = await withPatchLock(
    options.lockPath ?? defaultPatchLockPath(),
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

  return outcome ?? { status: "busy" };
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
    case "failed":
      return {
        level: "warning",
        message:
          `Automatic re-apply of the pi-subagents compatibility patches failed: ${result.detail}\n` +
          `Run manually and review the output: node "${patchScriptPath}"`,
      };
  }
}
