import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PATCH_TARGETS,
  checkPatchDrift,
  formatPatchDriftWarning,
  formatReapplyNotice,
  readInstalledPiSubagentsVersion,
  readPinnedPiSubagentsVersion,
  reapplyPatchesIfVersionMatches,
} from "../../src/welcome/patch-drift";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "thanos-patch-drift-"));
  roots.push(root);
  return root;
}

describe("pi-subagents compatibility drift", () => {
  it("reports an absent package as not installed", async () => {
    expect(await checkPatchDrift(join(tmpdir(), "definitely-not-installed"))).toEqual({
      installed: false,
      missingMarkers: [],
    });
  });

  it("reports missing markers without mutating package source", async () => {
    const root = await tempRoot();
    const target = PATCH_TARGETS[0];
    const path = join(root, target.file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "upstream source\n", "utf-8");

    expect(await checkPatchDrift(root)).toEqual({
      installed: true,
      missingMarkers: PATCH_TARGETS.map((entry) => entry.marker),
    });
    expect(await readFile(path, "utf-8")).toBe("upstream source\n");
  });

  it("stays silent when every compatibility marker is present", async () => {
    const root = await tempRoot();
    for (const target of PATCH_TARGETS) {
      const path = join(root, target.file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, target.marker, "utf-8");
    }
    const result = await checkPatchDrift(root);
    expect(result.missingMarkers).toEqual([]);
    expect(formatPatchDriftWarning(result)).toBeUndefined();
  });

  it("renders a controlled update command for actionable drift", () => {
    const warning = formatPatchDriftWarning(
      { installed: true, missingMarkers: [PATCH_TARGETS[0].marker] },
      "/opt/thanos/scripts/patch-pi-subagents.mjs",
    );
    expect(warning).toContain("compatibility patches are missing");
    expect(warning).toContain("controlled update boundary");
    expect(warning).toContain("/opt/thanos/scripts/patch-pi-subagents.mjs");
  });

  it("keeps detector markers synchronized with the standalone patch script", async () => {
    const script = await readFile(join(import.meta.dirname, "..", "..", "scripts", "patch-pi-subagents.mjs"), "utf-8");
    for (const target of PATCH_TARGETS) expect(script).toContain(target.marker);
  });
});

/**
 * Builds a fake install: `<root>` is the package's src dir, so the manifest the
 * detector reads sits one level up, exactly as it does in node_modules.
 */
async function fakeInstall(version: string, patched: boolean): Promise<string> {
  const pkg = await tempRoot();
  const root = join(pkg, "src");
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "pi-subagents", version }), "utf-8");
  for (const target of PATCH_TARGETS) {
    const path = join(root, target.file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, patched ? target.marker : "upstream source\n", "utf-8");
  }
  return root;
}

async function fakeThanosRoot(pin: string, withScript = true): Promise<string> {
  const dir = await tempRoot();
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ devDependencies: { "pi-subagents": pin } }),
    "utf-8",
  );
  if (withScript) {
    await mkdir(join(dir, "scripts"), { recursive: true });
    await writeFile(join(dir, "scripts", "patch-pi-subagents.mjs"), "// noop\n", "utf-8");
  }
  return dir;
}

describe("automatic re-apply after a reinstall", () => {
  it("re-applies when the installed version matches the pin", async () => {
    const root = await fakeInstall("0.37.2", false);
    const thanosRoot = await fakeThanosRoot("0.37.2");
    const lockPath = join(await tempRoot(), "lock");

    let ran = 0;
    const result = await reapplyPatchesIfVersionMatches({
      root,
      thanosRoot,
      lockPath,
      runPatchScript: async () => {
        ran++;
        // Stand in for the real script: write the markers the detector looks for.
        for (const target of PATCH_TARGETS) await writeFile(join(root, target.file), target.marker, "utf-8");
      },
    });

    expect(ran).toBe(1);
    expect(result.status).toBe("reapplied");
    expect(formatReapplyNotice(result)?.level).toBe("info");
  });

  it("refuses to touch node_modules when the version moved", async () => {
    const root = await fakeInstall("0.38.0", false);
    const thanosRoot = await fakeThanosRoot("0.37.2");

    let ran = 0;
    const result = await reapplyPatchesIfVersionMatches({
      root,
      thanosRoot,
      lockPath: join(await tempRoot(), "lock"),
      runPatchScript: async () => { ran++; },
    });

    expect(ran).toBe(0);
    expect(result).toMatchObject({ status: "version-mismatch", installed: "0.38.0", pinned: "0.37.2" });
    const notice = formatReapplyNotice(result);
    expect(notice?.level).toBe("warning");
    expect(notice?.message).toContain("0.38.0");
    expect(notice?.message).toContain("controlled update boundary");
    // The unpatched source must survive a refusal untouched.
    expect(await readFile(join(root, PATCH_TARGETS[0].file), "utf-8")).toBe("upstream source\n");
  });

  it("treats an unreadable version as a mismatch rather than a match", async () => {
    const root = await fakeInstall("0.37.2", false);
    const thanosRoot = await tempRoot(); // no package.json => no discoverable pin

    let ran = 0;
    const result = await reapplyPatchesIfVersionMatches({
      root,
      thanosRoot,
      lockPath: join(await tempRoot(), "lock"),
      runPatchScript: async () => { ran++; },
    });

    expect(ran).toBe(0);
    expect(result).toMatchObject({ status: "version-mismatch", pinned: undefined });
  });

  it("does nothing when the patches are already present", async () => {
    const root = await fakeInstall("0.37.2", true);
    let ran = 0;
    const result = await reapplyPatchesIfVersionMatches({
      root,
      thanosRoot: await fakeThanosRoot("0.37.2"),
      lockPath: join(await tempRoot(), "lock"),
      runPatchScript: async () => { ran++; },
    });

    expect(ran).toBe(0);
    expect(result).toEqual({ status: "clean" });
    expect(formatReapplyNotice(result)).toBeUndefined();
  });

  it("reports a script that exits cleanly but leaves markers absent", async () => {
    const root = await fakeInstall("0.37.2", false);
    const result = await reapplyPatchesIfVersionMatches({
      root,
      thanosRoot: await fakeThanosRoot("0.37.2"),
      lockPath: join(await tempRoot(), "lock"),
      runPatchScript: async () => {}, // exits 0, changes nothing
    });

    expect(result.status).toBe("failed");
    expect(formatReapplyNotice(result)?.level).toBe("warning");
  });

  it("surfaces a failing patch script instead of swallowing it", async () => {
    const root = await fakeInstall("0.37.2", false);
    const result = await reapplyPatchesIfVersionMatches({
      root,
      thanosRoot: await fakeThanosRoot("0.37.2"),
      lockPath: join(await tempRoot(), "lock"),
      runPatchScript: async () => { throw new Error("git apply exploded"); },
    });

    expect(result).toMatchObject({ status: "failed" });
    expect(formatReapplyNotice(result)?.message).toContain("git apply exploded");
  });

  it("stays silent when another session holds the lock", async () => {
    const root = await fakeInstall("0.37.2", false);
    const lockPath = join(await tempRoot(), "lock");
    await mkdir(lockPath, { recursive: true }); // a live holder

    let ran = 0;
    const result = await reapplyPatchesIfVersionMatches({
      root,
      thanosRoot: await fakeThanosRoot("0.37.2"),
      lockPath,
      runPatchScript: async () => { ran++; },
    });

    expect(ran).toBe(0);
    expect(result).toEqual({ status: "busy" });
    expect(formatReapplyNotice(result)).toBeUndefined();
  });

  it("surfaces a crashed holder's lock instead of clearing it", async () => {
    const root = await fakeInstall("0.37.2", false);
    const lockPath = join(await tempRoot(), "lock");
    await mkdir(lockPath, { recursive: true });
    // Backdate well past LOCK_STALE_MS: the holder is gone, not slow.
    const old = new Date(Date.now() - 60 * 60_000);
    await utimes(lockPath, old, old);

    let ran = 0;
    const result = await reapplyPatchesIfVersionMatches({
      root,
      thanosRoot: await fakeThanosRoot("0.37.2"),
      lockPath,
      runPatchScript: async () => { ran++; },
    });

    // Deleting a lock we merely believe is abandoned is the check-then-act race
    // that lets two sessions rewrite node_modules at once. Warn, never reclaim.
    expect(ran).toBe(0);
    expect(result).toMatchObject({ status: "stale-lock", lockPath });
    expect(existsSync(lockPath)).toBe(true);
    const notice = formatReapplyNotice(result);
    expect(notice?.level).toBe("warning");
    expect(notice?.message).toContain("crashed");
  });

  it("releases the lock after a run so the next session can take it", async () => {
    const root = await fakeInstall("0.37.2", false);
    const thanosRoot = await fakeThanosRoot("0.37.2");
    const lockPath = join(await tempRoot(), "lock");

    const apply = async () => {
      for (const target of PATCH_TARGETS) await writeFile(join(root, target.file), target.marker, "utf-8");
    };
    expect((await reapplyPatchesIfVersionMatches({ root, thanosRoot, lockPath, runPatchScript: apply })).status)
      .toBe("reapplied");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("releases the lock even when the patch script throws", async () => {
    const root = await fakeInstall("0.37.2", false);
    const lockPath = join(await tempRoot(), "lock");
    const result = await reapplyPatchesIfVersionMatches({
      root,
      thanosRoot: await fakeThanosRoot("0.37.2"),
      lockPath,
      runPatchScript: async () => { throw new Error("boom"); },
    });
    expect(result.status).toBe("failed");
    // A lock leaked on the error path would wedge every later session.
    expect(existsSync(lockPath)).toBe(false);
  });

  it("reports an absent package without attempting a run", async () => {
    const result = await reapplyPatchesIfVersionMatches({
      root: join(tmpdir(), "definitely-not-installed"),
      thanosRoot: await fakeThanosRoot("0.37.2"),
      runPatchScript: async () => { throw new Error("must not run"); },
    });
    expect(result).toEqual({ status: "not-installed" });
  });

  it("reads the real pin as an exact version so the equality check is meaningful", async () => {
    const pinned = await readPinnedPiSubagentsVersion();
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    // The V2 patch artifact is cut against one specific release; if the pin moves
    // without a new artifact, auto-reapply would run a patch built for old code.
    const patches = await readFile(join(import.meta.dirname, "..", "..", "scripts", "patch-pi-subagents.mjs"), "utf-8");
    expect(patches).toContain(`pi-subagents-${pinned}-v2-evidence.patch`);
  });

  it("reads a version back out of an installed package layout", async () => {
    expect(await readInstalledPiSubagentsVersion(await fakeInstall("1.2.3", true))).toBe("1.2.3");
    expect(await readInstalledPiSubagentsVersion(join(tmpdir(), "nope"))).toBeUndefined();
  });
});
