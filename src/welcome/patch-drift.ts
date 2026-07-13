import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Mirrors scripts/patch-pi-subagents.mjs's `patches` list — keep both in sync
// if a patch is added, retired, or its marker string changes. Duplicated
// rather than imported: that script runs standalone via `node` outside the
// tsc/eslint project (see tsconfig.json's `include`), so cross-importing it
// into src/ would need allowJs and a build-time coupling neither side wants.
// tests/welcome/patch-drift.test.ts cross-checks both files' text stay in
// sync so this duplication can't silently drift.
export const PATCH_TARGETS = [
  { file: join("agents", "agents.ts"), marker: "thanos-patch: skip skills dirs" },
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
 * Checks whether both Thanos patches are still present in the installed
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
