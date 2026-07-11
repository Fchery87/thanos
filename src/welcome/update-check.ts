import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LATEST_RELEASE_URL = "https://api.github.com/repos/Fchery87/thanos/releases/latest";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;

// The Thanos install root (~/.pi), independent of the session cwd.
const installRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface UpdateCheckResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

interface UpdateCache {
  checkedAt: number;
  latestTag: string;
}

/** Numeric compare of dotted versions; ignores a leading `v` and any prerelease suffix. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split("-")[0].split(".").map((p) => Number.parseInt(p, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}

export async function readCurrentVersion(root = installRoot): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

async function fetchLatestReleaseTag(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LATEST_RELEASE_URL, {
      signal: controller.signal,
      headers: { accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string };
    return typeof body.tag_name === "string" && body.tag_name.length > 0 ? body.tag_name : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface CheckForUpdateOptions {
  currentVersion?: string | null;
  cachePath?: string;
  ttlMs?: number;
  now?: number;
  fetchLatestTag?: () => Promise<string | null>;
}

/**
 * Compare the installed version against the latest GitHub release. The result is
 * cached on disk (default 24h) so startup stays fast and the API is not hammered.
 * Never throws; returns null when the version can't be determined (offline, no
 * releases, missing package.json).
 */
export async function checkForUpdate(options: CheckForUpdateOptions = {}): Promise<UpdateCheckResult | null> {
  if (process.env.THANOS_SKIP_UPDATE_CHECK === "1") return null;

  const {
    cachePath = join(installRoot, ".harness", "update-check.json"),
    ttlMs = DEFAULT_TTL_MS,
    now = Date.now(),
    fetchLatestTag = fetchLatestReleaseTag,
  } = options;

  const current = options.currentVersion ?? (await readCurrentVersion());
  if (!current) return null;

  let latestTag: string | null = null;

  try {
    const cache = JSON.parse(await readFile(cachePath, "utf-8")) as UpdateCache;
    if (typeof cache.latestTag === "string" && typeof cache.checkedAt === "number" && now - cache.checkedAt < ttlMs) {
      latestTag = cache.latestTag;
    }
  } catch { /* no cache yet */ }

  if (!latestTag) {
    latestTag = await fetchLatestTag();
    if (!latestTag) return null;
    try {
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify({ checkedAt: now, latestTag } satisfies UpdateCache), "utf-8");
    } catch { /* cache write is best-effort */ }
  }

  return {
    current,
    latest: latestTag,
    updateAvailable: isNewerVersion(latestTag, current),
  };
}
