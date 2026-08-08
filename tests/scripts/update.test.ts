import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planUpdate, reassertExactManifestPin, spawnRelay } from "../../scripts/thanos-update.mjs";

const ok = { code: 0 };
const fail = { code: 1 };

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function manifestFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "thanos-update-manifest-"));
  dirs.push(dir);
  const path = join(dir, "package.json");
  await writeFile(path, content, "utf-8");
  return path;
}

describe("thanos update", () => {
  it("moves to the pinned target when it differs and the patch succeeds", async () => {
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      readPinnedTarget: async () => "0.42.1",
      installPinned: async (v) => { calls.push(`install:${v}`); return ok; },
      runPatchScript: async () => { calls.push("patch"); return ok; },
    });
    expect(result.status).toBe("updated");
    expect(result.from).toBe("0.41.0");
    expect(result.to).toBe("0.42.1");
    expect(calls).toEqual(["install:0.42.1", "patch"]);
  });

  it("does not call installPinned when the installed version already matches the pin, but still runs the patch script as a self-heal check", async () => {
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      readPinnedTarget: async () => "0.41.0",
      installPinned: async (v) => { calls.push(`install:${v}`); return ok; },
      runPatchScript: async () => { calls.push("patch"); return ok; },
    });
    expect(result.status).toBe("unchanged");
    expect(calls).toEqual(["patch"]);
  });

  it("reports install-failed when installPinned fails to reach the target — nothing is rolled back since nothing was confirmed to move", async () => {
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      readPinnedTarget: async () => "0.42.1",
      installPinned: async (v) => { calls.push(`install:${v}`); return fail; },
      runPatchScript: async () => { calls.push("patch"); return ok; },
    });
    expect(result.status).toBe("install-failed");
    expect(calls).toEqual(["install:0.42.1"]);
  });

  it("rolls back the pin to the previous version when the patch fails, and only reports success once the re-patch after rollback actually succeeds", async () => {
    // installPinned is called twice: once for the forward move (0.41.0 ->
    // 0.42.1), once for the rollback (0.42.1 -> 0.41.0) — proving the
    // rollback restores agent/settings.json's pin, not just the binary on
    // disk. Distinguishing the two patch calls is load-bearing for the same
    // reason it was in the pi-update-based version: a mock that returned the
    // same result for both calls could not tell apart "rollback's re-patch
    // genuinely succeeded" from "never actually checked".
    const installCalls: string[] = [];
    let patchCallCount = 0;
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      readPinnedTarget: async () => "0.42.1",
      installPinned: async (v) => { installCalls.push(v); return ok; },
      runPatchScript: async () => {
        patchCallCount++;
        return patchCallCount === 1 ? fail : ok;
      },
    });
    expect(result.status).toBe("rolled-back");
    expect(result.from).toBe("0.41.0");
    expect(installCalls).toEqual(["0.42.1", "0.41.0"]);
    expect(patchCallCount).toBe(2);
  });

  it("reports broken when the rollback's installPinned itself fails — no re-patch is attempted against a pin that was never restored", async () => {
    const installCalls: string[] = [];
    let patchCallCount = 0;
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      readPinnedTarget: async () => "0.42.1",
      installPinned: async (v) => {
        installCalls.push(v);
        return v === "0.42.1" ? ok : fail;
      },
      runPatchScript: async () => { patchCallCount++; return fail; },
    });
    expect(result.status).toBe("broken");
    expect(result.from).toBe("0.41.0");
    expect(installCalls).toEqual(["0.42.1", "0.41.0"]);
    expect(patchCallCount).toBe(1);
  });

  it("reports broken when the rollback's installPinned succeeds but the re-patch still fails — never reports rolled-back on an unpatched install", async () => {
    // Mirrors the exact defect a prior version of this wrapper had when it
    // used a raw reinstall(before) for rollback: gating success on the
    // install call's exit code alone would report "rolled-back" here even
    // though the harness is still unpatched.
    const installCalls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      readPinnedTarget: async () => "0.42.1",
      installPinned: async (v) => { installCalls.push(v); return ok; },
      runPatchScript: async () => fail,
    });
    expect(result.status).toBe("broken");
    expect(result.from).toBe("0.41.0");
    expect(installCalls).toEqual(["0.42.1", "0.41.0"]);
  });

  describe("reassertExactManifestPin (real file I/O)", () => {
    it("writes the exact version when dependencies is missing entirely", async () => {
      const path = await manifestFile(JSON.stringify({ name: "pi-extensions" }));
      await reassertExactManifestPin("0.42.1", path);
      const manifest = JSON.parse(await readFile(path, "utf-8"));
      expect(manifest.dependencies["pi-subagents"]).toBe("0.42.1");
    });

    it("replaces a caret range with the exact version", async () => {
      const path = await manifestFile(JSON.stringify({ dependencies: { "pi-subagents": "^0.42.1" } }));
      await reassertExactManifestPin("0.42.1", path);
      const manifest = JSON.parse(await readFile(path, "utf-8"));
      expect(manifest.dependencies["pi-subagents"]).toBe("0.42.1");
    });

    it("is a no-op when the pin is already exact", async () => {
      const path = await manifestFile(JSON.stringify({ dependencies: { "pi-subagents": "0.42.1" } }));
      const before = await readFile(path, "utf-8");
      await reassertExactManifestPin("0.42.1", path);
      expect(await readFile(path, "utf-8")).toBe(before);
    });

    it("preserves other dependencies untouched", async () => {
      const path = await manifestFile(JSON.stringify({ dependencies: { "pi-web-access": "^0.18.0" } }));
      await reassertExactManifestPin("0.42.1", path);
      const manifest = JSON.parse(await readFile(path, "utf-8"));
      expect(manifest.dependencies["pi-web-access"]).toBe("^0.18.0");
      expect(manifest.dependencies["pi-subagents"]).toBe("0.42.1");
    });

    it("throws rather than silently reindexing a malformed (array) dependencies field", async () => {
      const path = await manifestFile(JSON.stringify({ dependencies: ["not", "an", "object"] }));
      await expect(reassertExactManifestPin("0.42.1", path)).rejects.toThrow(/malformed/);
      const manifest = JSON.parse(await readFile(path, "utf-8"));
      expect(manifest.dependencies).toEqual(["not", "an", "object"]);
    });
  });

  describe("spawnRelay (real subprocess wiring)", () => {
    it("resolves with a non-zero code rather than rejecting when the command itself can't be spawned", async () => {
      // planUpdate's contract is that every injected effect resolves to
      // { code }, never rejects. main()'s real effects (installPinnedReal,
      // runPatchScriptReal) are both built on this function, so a bad
      // command (ENOENT) has to look like an ordinary non-zero exit, not an
      // uncaught rejection that would skip past the "broken" status's
      // detailed recovery message and land in main()'s generic outer catch.
      const result = await spawnRelay("definitely-not-a-real-command-xyz123", []);
      expect(result).toEqual({ code: 1 });
    });

    it("resolves with the real exit code for a command that runs", async () => {
      const result = await spawnRelay(process.execPath, ["-e", "process.exit(0)"]);
      expect(result).toEqual({ code: 0 });
    });
  });
});
