import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Mirrors scripts/patch-pi-subagents.mjs. Compatibility patches are applied by
// install/update commands; session startup only reports drift.
export const PATCH_TARGETS = [
  { file: join("extension", "fanout-child.ts"), marker: "thanos-patch: process-global fanout tool guard" },
  { file: join("api", "delegation.ts"), marker: "thanos-patch: V2 evidence envelope types" },
  { file: join("slash", "delegation-request.ts"), marker: "thanos-patch: V2 acceptance request validation" },
  { file: join("slash", "delegation-adapters.ts"), marker: "thanos-patch: V2 evidence envelope projection" },
] as const;

export function defaultPiSubagentsSrcRoot(): string {
  return join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents", "src");
}

function defaultPatchScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "patch-pi-subagents.mjs");
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
