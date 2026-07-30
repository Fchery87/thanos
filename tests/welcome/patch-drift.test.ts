import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PATCH_TARGETS,
  checkPatchDrift,
  formatPatchDriftWarning,
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
