import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// pi resolves an update spec that carries no explicit version as `<name>@latest`
// (package-manager.js:911). pi-subagents is the one package whose version the
// patch artifact is cut against, so an unpinned spec silently walks it forward
// into a version no patch applies to. agent/settings.json is gitignored, so this
// pin is untracked local state and nothing else notices when it drifts.

const DELEGATION_PACKAGE = "pi-subagents";
const EXACT_VERSION = /@\d+\.\d+\.\d+$/;

/** Returns the offending spec, or undefined when the pin is exact. */
export function findUnpinnedDelegationPackage(packages: readonly unknown[]): string | undefined {
  for (const entry of packages) {
    const spec = typeof entry === "string" ? entry : undefined;
    if (spec === undefined) continue;
    if (!spec.startsWith(`npm:${DELEGATION_PACKAGE}`)) continue;
    // Guard against a longer name that merely shares the prefix.
    const tail = spec.slice(`npm:${DELEGATION_PACKAGE}`.length);
    if (tail !== "" && !tail.startsWith("@")) continue;
    // Keep scanning past an exact match — a malformed settings.json could
    // carry a second, unpinned entry for the same package, and returning
    // here on the first match would hide it.
    if (EXACT_VERSION.test(spec)) continue;
    return spec;
  }
  return undefined;
}

export function formatUnpinnedPinWarning(
  spec: string,
  settingsPath: string = defaultSettingsPath(),
): string {
  return (
    `pi-subagents is not pinned to an exact version (found "${spec}").\n` +
    `pi resolves this as @latest on the next \`pi update --extensions\`, and the ` +
    `patch artifact only applies to the pinned version.\n` +
    `Fix: set "npm:${DELEGATION_PACKAGE}@<version>" in ${settingsPath}.`
  );
}

/**
 * `agent/settings.json` relative to the Thanos repo root — same file the
 * `pi` package manager reads its `packages` update specs from. Mirrors the
 * settingsPath() resolvers already duplicated in src/goal/load-settings.ts,
 * src/spec/extractor.ts, and src/agents/model-routing.ts rather than adding
 * a fourth shared abstraction for a one-line path join.
 */
export function defaultSettingsPath(): string {
  const home = homedir();
  return home ? join(home, ".pi", "agent", "settings.json") : join(process.cwd(), "agent", "settings.json");
}

/**
 * Best-effort read of the pin drift for the pi-subagents package spec.
 * Returns undefined when the file does not exist yet (nothing configured to
 * drift), when `packages` is absent, or when the pin is exact. Malformed
 * JSON in a file that does exist propagates — that is a real problem worth
 * surfacing, not silence.
 */
export async function checkPinDrift(settingsPath: string = defaultSettingsPath()): Promise<string | undefined> {
  if (!existsSync(settingsPath)) return undefined;
  const parsed = JSON.parse(await readFile(settingsPath, "utf-8")) as { packages?: unknown };
  const packages = Array.isArray(parsed.packages) ? parsed.packages : [];
  return findUnpinnedDelegationPackage(packages);
}
