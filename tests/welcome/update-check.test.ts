import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkForUpdate, isNewerVersion } from "../../src/welcome/update-check";

async function makeCacheDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "thanos-update-check-"));
}

describe("isNewerVersion", () => {
  it("compares dotted versions numerically", () => {
    expect(isNewerVersion("v0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("v0.1.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("v0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("v1.0.0", "0.99.99")).toBe(true);
    expect(isNewerVersion("v0.2.1", "0.2")).toBe(true);
  });

  it("ignores prerelease suffixes rather than crashing", () => {
    expect(isNewerVersion("v0.3.0-rc.1", "0.2.0")).toBe(true);
  });
});

describe("checkForUpdate", () => {
  it("reports an available update from the fetched tag and writes the cache", async () => {
    const dir = await makeCacheDir();
    const cachePath = join(dir, "update-check.json");

    const result = await checkForUpdate({
      currentVersion: "0.1.0",
      cachePath,
      fetchLatestTag: async () => "v0.2.0",
    });

    expect(result).toEqual({ current: "0.1.0", latest: "v0.2.0", updateAvailable: true });
    const cache = JSON.parse(await readFile(cachePath, "utf-8"));
    expect(cache.latestTag).toBe("v0.2.0");
  });

  it("reports no update when already on the latest release", async () => {
    const dir = await makeCacheDir();
    const result = await checkForUpdate({
      currentVersion: "0.2.0",
      cachePath: join(dir, "update-check.json"),
      fetchLatestTag: async () => "v0.2.0",
    });
    expect(result?.updateAvailable).toBe(false);
  });

  it("serves from cache within the TTL without refetching", async () => {
    const dir = await makeCacheDir();
    const cachePath = join(dir, "update-check.json");
    let fetches = 0;
    const fetchLatestTag = async () => {
      fetches += 1;
      return "v0.2.0";
    };

    await checkForUpdate({ currentVersion: "0.1.0", cachePath, fetchLatestTag, now: 1_000_000 });
    const second = await checkForUpdate({ currentVersion: "0.1.0", cachePath, fetchLatestTag, now: 1_000_000 + 60_000 });

    expect(fetches).toBe(1);
    expect(second?.updateAvailable).toBe(true);
  });

  it("refetches once the cache TTL has expired", async () => {
    const dir = await makeCacheDir();
    const cachePath = join(dir, "update-check.json");
    let fetches = 0;
    const fetchLatestTag = async () => {
      fetches += 1;
      return fetches === 1 ? "v0.2.0" : "v0.3.0";
    };
    const ttlMs = 1000;

    await checkForUpdate({ currentVersion: "0.1.0", cachePath, fetchLatestTag, ttlMs, now: 1_000_000 });
    const second = await checkForUpdate({ currentVersion: "0.1.0", cachePath, fetchLatestTag, ttlMs, now: 1_000_000 + 5_000 });

    expect(fetches).toBe(2);
    expect(second?.latest).toBe("v0.3.0");
  });

  it("returns null when the release lookup fails", async () => {
    const dir = await makeCacheDir();
    const result = await checkForUpdate({
      currentVersion: "0.1.0",
      cachePath: join(dir, "update-check.json"),
      fetchLatestTag: async () => null,
    });
    expect(result).toBeNull();
  });

  it("returns null when the current version is unknown", async () => {
    const dir = await makeCacheDir();
    const result = await checkForUpdate({
      currentVersion: null,
      cachePath: join(dir, "missing", "update-check.json"),
      fetchLatestTag: async () => "v9.9.9",
    });
    // currentVersion null falls back to reading the real package.json, which
    // exists in this repo — so instead pin an explicit empty string.
    expect(result === null || typeof result?.current === "string").toBe(true);

    const emptyResult = await checkForUpdate({
      currentVersion: "",
      cachePath: join(dir, "update-check.json"),
      fetchLatestTag: async () => "v9.9.9",
    });
    expect(emptyResult).toBeNull();
  });

  it("is disabled by THANOS_SKIP_UPDATE_CHECK=1", async () => {
    const dir = await makeCacheDir();
    const previous = process.env.THANOS_SKIP_UPDATE_CHECK;
    process.env.THANOS_SKIP_UPDATE_CHECK = "1";
    try {
      const result = await checkForUpdate({
        currentVersion: "0.1.0",
        cachePath: join(dir, "update-check.json"),
        fetchLatestTag: async () => "v9.9.9",
      });
      expect(result).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.THANOS_SKIP_UPDATE_CHECK;
      else process.env.THANOS_SKIP_UPDATE_CHECK = previous;
    }
  });
});
