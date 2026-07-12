import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  type Registry,
  type ShipFile,
  parseRegistry,
  parseShipFile,
} from "./delivery-types";

const execFileAsync = promisify(execFile);

export type DeliveryMode = "local-only" | "direct-PR" | "no-mistakes";
export type DeliveryAutonomy = "attended" | "unattended";
export type DeliveryMerge = "fast-forward" | "pr";

export interface ResolvedDelivery {
  mode: DeliveryMode;
  autonomy: DeliveryAutonomy;
  gates: Record<string, string | null>;
  defaultBranch: string;
  merge: DeliveryMerge;
  yoloLocked: boolean;
  /** True when a registry entry matched this repo (vs. falling to the default). */
  registered: boolean;
}

export interface RepoId {
  remote: string | null;
  path: string;
}

export interface ResolveDeliveryInputs {
  registry: Registry | null;
  shipFile: ShipFile | null;
  repoId: RepoId;
}

/**
 * PURE delivery resolution with a trust-split.
 *
 * TRUSTED half (mode, autonomy, yolo lock) comes ONLY from the captain
 * registry. UNTRUSTED half (gates, defaultBranch, merge) comes from the
 * repo-committed ship file. mode/autonomy/yolo are NEVER read from `shipFile`,
 * even if a repo smuggles those keys in — `shipFile` is only ever consulted for
 * gates/defaultBranch/merge below.
 *
 * Fail-safe: a null registry collapses to the most restrictive safe defaults
 * (local-only / attended). We never fall back to something more permissive.
 */
export function resolveDelivery(inputs: ResolveDeliveryInputs): ResolvedDelivery {
  const { registry, shipFile, repoId } = inputs;

  const def = registry?.default ?? { mode: "local-only", autonomy: "attended" };

  const entry = registry?.projects.find(
    (p) =>
      (p.match != null && repoId.remote != null && p.match === repoId.remote) ||
      (p.path != null && p.path === repoId.path),
  );

  // TRUSTED: mode/autonomy/yolo come only from the registry (entry, then
  // default). shipFile is intentionally not consulted here.
  const mode: DeliveryMode = entry?.mode ?? def.mode;
  const autonomy: DeliveryAutonomy = entry?.autonomy ?? def.autonomy;
  const yoloLocked = entry?.yolo === "locked" || registry?.yolo === "disabled";

  // UNTRUSTED: mechanics from the repo-committed ship file.
  const gates = shipFile?.gates ?? {};
  const defaultBranch = shipFile?.defaultBranch ?? "main";
  const merge: DeliveryMerge =
    shipFile?.merge ?? (mode === "direct-PR" ? "pr" : "fast-forward");

  return { mode, autonomy, gates, defaultBranch, merge, yoloLocked, registered: entry !== undefined };
}

function isMissingFile(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}

/** Absolute path of the trusted captain registry file. */
export function registryPath(): string {
  const home = homedir() || process.env.HOME || "";
  return path.join(home, ".pi", "agent", "projects.json");
}

/** Read + parse the trusted captain registry. Fail-safe to null; never throws. */
export async function loadRegistry(): Promise<Registry | null> {
  const filePath = registryPath();
  try {
    const raw = await readFile(filePath, "utf-8");
    return parseRegistry(JSON.parse(raw) as unknown);
  } catch (err) {
    if (isMissingFile(err)) return null; // missing file is normal: no warning
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[delivery] Ignoring malformed registry at ${filePath}: ${reason}`);
    return null;
  }
}

/** Read + parse the untrusted ship file. Fail-safe to null; never throws. */
async function loadShipFile(cwd: string): Promise<ShipFile | null> {
  const filePath = path.join(cwd, ".thanos", "delivery.json");
  try {
    const raw = await readFile(filePath, "utf-8");
    return parseShipFile(JSON.parse(raw) as unknown);
  } catch (err) {
    if (isMissingFile(err)) return null; // missing file is normal: no warning
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[delivery] Ignoring malformed ship file at ${filePath}: ${reason}`);
    return null;
  }
}

/** Repo identity as the registry sees it: origin remote (or null) + resolved path. */
export async function readRepoId(cwd: string): Promise<RepoId> {
  return { remote: await readRemote(cwd), path: path.resolve(cwd) };
}

/** Best-effort `git remote get-url origin`. Any failure/empty output -> null. */
async function readRemote(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      cwd,
      "remote",
      "get-url",
      "origin",
    ]);
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * The ONLY IO entrypoint. Loads the trusted registry and untrusted ship file,
 * computes the repo identity, then delegates to the pure `resolveDelivery`.
 * Every IO failure is fail-safe (null), so resolution falls back to the most
 * restrictive safe defaults rather than ever throwing or escalating trust.
 */
export async function resolveDeliveryState(cwd: string): Promise<ResolvedDelivery> {
  const [registry, shipFile, repoId] = await Promise.all([
    loadRegistry(),
    loadShipFile(cwd),
    readRepoId(cwd),
  ]);

  return resolveDelivery({ registry, shipFile, repoId });
}
