import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadRegistry, readRepoId, resolveDeliveryState } from "../../src/governance/delivery";
import { saveRegistry, upsertRegistryEntry } from "../../src/governance/delivery-select";
import { parseRegistry } from "../../src/governance/delivery-types";

const SAFE = { mode: "local-only", autonomy: "attended" } as const;

describe("upsertRegistryEntry (pure)", () => {
  it("creates a fresh registry with safe defaults when none exists", () => {
    const r = upsertRegistryEntry(null, { remote: "https://github.com/me/x.git", path: "/home/me/x" }, "direct-PR");
    // Must be schema-valid — this is what gets written to the trusted registry.
    expect(() => parseRegistry(r)).not.toThrow();
    expect(r.default).toEqual(SAFE);
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0]).toEqual({
      match: "https://github.com/me/x.git",
      path: "/home/me/x",
      mode: "direct-PR",
      autonomy: "attended",
    });
  });

  it("appends a new entry without mutating the input registry", () => {
    const existing = parseRegistry({
      version: 1,
      default: SAFE,
      projects: [{ match: "r1", mode: "local-only", autonomy: "attended" }],
    });
    const r = upsertRegistryEntry(existing, { remote: "r2", path: "/p2" }, "no-mistakes");
    expect(r.projects).toHaveLength(2);
    expect(r.projects[1]).toMatchObject({ match: "r2", mode: "no-mistakes" });
    // Input untouched (the caller may still hold it).
    expect(existing.projects).toHaveLength(1);
  });

  it("replaces an existing entry matched by remote instead of duplicating", () => {
    const existing = parseRegistry({
      version: 1,
      default: SAFE,
      projects: [{ match: "r1", path: "/old", mode: "local-only", autonomy: "unattended", yolo: "locked" }],
    });
    const r = upsertRegistryEntry(existing, { remote: "r1", path: "/new" }, "direct-PR");
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0]).toMatchObject({ match: "r1", path: "/new", mode: "direct-PR" });
    // Trust-adjacent fields the selector does not manage are preserved.
    expect(r.projects[0].yolo).toBe("locked");
    expect(r.projects[0].autonomy).toBe("unattended");
  });

  it("replaces an existing entry matched by path when the repo has no remote", () => {
    const existing = parseRegistry({
      version: 1,
      default: SAFE,
      projects: [{ path: "/p", mode: "local-only", autonomy: "attended" }],
    });
    const r = upsertRegistryEntry(existing, { remote: null, path: "/p" }, "direct-PR");
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0]).toEqual({ path: "/p", mode: "direct-PR", autonomy: "attended" });
    // No remote → no match key smuggled in.
    expect("match" in r.projects[0]).toBe(false);
  });

  it("preserves the existing registry default rather than resetting it", () => {
    const existing = parseRegistry({
      version: 1,
      default: { mode: "direct-PR", autonomy: "unattended" },
      projects: [],
    });
    const r = upsertRegistryEntry(existing, { remote: "r", path: "/p" }, "local-only");
    expect(r.default).toEqual({ mode: "direct-PR", autonomy: "unattended" });
  });
});

describe("saveRegistry / loadRegistry / readRepoId (IO, hermetic HOME)", () => {
  let tmpHome: string;
  let tmpCwd: string;
  let oldHome: string | undefined;

  beforeEach(async () => {
    oldHome = process.env.HOME;
    tmpHome = await mkdtemp(path.join(tmpdir(), "delivery-select-home-"));
    tmpCwd = await mkdtemp(path.join(tmpdir(), "delivery-select-cwd-"));
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpCwd, { recursive: true, force: true });
  });

  it("saveRegistry creates ~/.pi/agent/ and roundtrips through loadRegistry", async () => {
    const registry = upsertRegistryEntry(null, { remote: "r", path: "/p" }, "direct-PR");
    await saveRegistry(registry);
    const loaded = await loadRegistry();
    expect(loaded).toEqual(registry);
    // Human-editable file: pretty-printed with a trailing newline.
    const raw = await readFile(path.join(tmpHome, ".pi", "agent", "projects.json"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain("\n  ");
  });

  it("readRepoId on a non-git dir yields null remote and the resolved path", async () => {
    const id = await readRepoId(tmpCwd);
    expect(id.remote).toBeNull();
    expect(id.path).toBe(path.resolve(tmpCwd));
  });

  it("select-then-persist flow flips resolveDeliveryState from default to registered", async () => {
    const before = await resolveDeliveryState(tmpCwd);
    expect(before.registered).toBe(false);
    expect(before.mode).toBe("local-only");

    const repoId = await readRepoId(tmpCwd);
    await saveRegistry(upsertRegistryEntry(await loadRegistry(), repoId, "direct-PR"));

    const after = await resolveDeliveryState(tmpCwd);
    expect(after.registered).toBe(true);
    expect(after.mode).toBe("direct-PR");
    expect(after.autonomy).toBe("attended"); // selector never grants autonomy
  });
});
