import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { DeliveryAutonomy, DeliveryMode, RepoId } from "./delivery";
import { registryPath } from "./delivery";
import type { Registry } from "./delivery-types";

/** The modes offered by the first-launch selector, in display order. */
export const DELIVERY_MODES: readonly DeliveryMode[] = ["local-only", "direct-PR", "no-mistakes"];

/** One-line description per mode, shown alongside the selector. */
export const DELIVERY_MODE_HELP: Record<DeliveryMode, string> = {
  "local-only": "commits stay on this machine — push and gh publish are denied",
  "direct-PR": "may push branches and open PRs (team policy preset)",
  "no-mistakes": "full delivery under the CI policy preset",
};

const SAFE_DEFAULT = { mode: "local-only", autonomy: "attended" } as const;

/**
 * PURE upsert of a project entry into the trusted captain registry.
 *
 * Matching mirrors resolveDelivery: an existing entry is replaced when its
 * `match` equals the repo's remote or its `path` equals the repo's path —
 * otherwise the entry is appended. On replace, fields the selector does not
 * manage (autonomy, yolo) are preserved; the selector only ever sets the mode
 * and refreshes the identity keys. New entries get attended autonomy: the
 * selector grants delivery, never autonomy.
 *
 * A null registry (no file yet) is created fresh with the restrictive safe
 * default — NOT the mode being granted, which applies only to this project.
 */
export function upsertRegistryEntry(
  registry: Registry | null,
  repoId: RepoId,
  mode: DeliveryMode,
  autonomy: DeliveryAutonomy = "attended",
): Registry {
  const base: Registry = registry ?? { version: 1, default: { ...SAFE_DEFAULT }, projects: [] };

  const identity = {
    ...(repoId.remote != null ? { match: repoId.remote } : {}),
    path: repoId.path,
  };

  const index = base.projects.findIndex(
    (p) =>
      (p.match != null && repoId.remote != null && p.match === repoId.remote) ||
      (p.path != null && p.path === repoId.path),
  );

  const projects = [...base.projects];
  if (index >= 0) {
    const existing = projects[index];
    projects[index] = {
      ...(existing.yolo != null ? { yolo: existing.yolo } : {}),
      ...identity,
      mode,
      autonomy: existing.autonomy,
    };
  } else {
    projects.push({ ...identity, mode, autonomy });
  }

  return { ...base, projects };
}

/**
 * Write the trusted registry to ~/.pi/agent/projects.json, creating the
 * directory if needed. Pretty-printed: the file is documented as hand-editable
 * and the selector must not clobber that. Throws on IO failure — callers
 * surface the error rather than silently believing the grant persisted.
 */
export async function saveRegistry(registry: Registry): Promise<void> {
  const filePath = registryPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
}
