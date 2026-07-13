import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPatchDrift, formatPatchDriftWarning, PATCH_TARGETS } from "../../src/welcome/patch-drift";

async function makeInstallRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "thanos-patch-drift-"));
}

async function writePatchTargets(root: string, markerPresence: boolean[]): Promise<void> {
  for (const [i, target] of PATCH_TARGETS.entries()) {
    const filePath = join(root, target.file);
    await mkdir(join(filePath, ".."), { recursive: true });
    const body = markerPresence[i]
      ? `// some code\n// ${target.marker}\nfunction x() {}\n`
      : "// some code\nfunction x() {}\n";
    await writeFile(filePath, body, "utf-8");
  }
}

describe("checkPatchDrift", () => {
  it("reports not installed when the pi-subagents src root does not exist", async () => {
    const root = join(await makeInstallRoot(), "does-not-exist");
    const result = await checkPatchDrift(root);
    expect(result).toEqual({ installed: false, missingMarkers: [] });
  });

  it("reports no missing markers when both patches are present", async () => {
    const root = await makeInstallRoot();
    await writePatchTargets(root, [true, true]);
    const result = await checkPatchDrift(root);
    expect(result).toEqual({ installed: true, missingMarkers: [] });
  });

  it("reports the specific marker missing when one patch reverted", async () => {
    const root = await makeInstallRoot();
    await writePatchTargets(root, [true, false]);
    const result = await checkPatchDrift(root);
    expect(result.installed).toBe(true);
    expect(result.missingMarkers).toEqual([PATCH_TARGETS[1].marker]);
  });

  it("reports both markers missing when both patches reverted", async () => {
    const root = await makeInstallRoot();
    await writePatchTargets(root, [false, false]);
    const result = await checkPatchDrift(root);
    expect(result.installed).toBe(true);
    expect(result.missingMarkers).toEqual(PATCH_TARGETS.map((t) => t.marker));
  });

  it("treats an installed package whose patch target file itself is missing as a missing marker", async () => {
    const root = await makeInstallRoot();
    // Only write the first target file — the second is absent entirely
    // (e.g. pi-subagents restructured its file layout).
    const first = PATCH_TARGETS[0];
    const filePath = join(root, first.file);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, `// ${first.marker}\n`, "utf-8");

    const result = await checkPatchDrift(root);
    expect(result.installed).toBe(true);
    expect(result.missingMarkers).toEqual([PATCH_TARGETS[1].marker]);
  });
});

describe("formatPatchDriftWarning", () => {
  it("returns undefined when the package is not installed", () => {
    expect(formatPatchDriftWarning({ installed: false, missingMarkers: [] })).toBeUndefined();
  });

  it("returns undefined when no markers are missing", () => {
    expect(formatPatchDriftWarning({ installed: true, missingMarkers: [] })).toBeUndefined();
  });

  it("names the patch script and the missing marker(s) when drift is detected", () => {
    const message = formatPatchDriftWarning({ installed: true, missingMarkers: [PATCH_TARGETS[0].marker] });
    expect(message).toContain("patch-pi-subagents.mjs");
    expect(message).toContain(PATCH_TARGETS[0].marker);
  });

  it("uses the given patch script path rather than assuming a fixed install directory", () => {
    // Regression guard: an earlier version hardcoded "~/.pi", which is wrong
    // for a custom install directory (scripts/install.sh --dir / THANOS_DIR).
    const message = formatPatchDriftWarning(
      { installed: true, missingMarkers: [PATCH_TARGETS[0].marker] },
      "/custom/install/dir/scripts/patch-pi-subagents.mjs",
    );
    expect(message).toContain("/custom/install/dir/scripts/patch-pi-subagents.mjs");
    expect(message).not.toContain("~/.pi");
  });
});

describe("PATCH_TARGETS stays in sync with scripts/patch-pi-subagents.mjs", () => {
  it("has every marker and target file path present in the real patch script's source", async () => {
    // The patch script runs standalone outside the tsc project (see the
    // comment in src/welcome/patch-drift.ts), so PATCH_TARGETS is a
    // deliberate duplicate rather than an import. This test is what keeps
    // that duplication from silently drifting: if a patch's marker or file
    // path changes in one place and not the other, this fails.
    const scriptPath = join(__dirname, "..", "..", "scripts", "patch-pi-subagents.mjs");
    const scriptSource = await readFile(scriptPath, "utf-8");
    for (const target of PATCH_TARGETS) {
      expect(scriptSource).toContain(target.marker);
      // The script joins path segments across lines (join("agents", "agents.ts")),
      // so check each path segment individually rather than the joined string.
      for (const segment of target.file.split("/")) {
        expect(scriptSource).toContain(`"${segment}"`);
      }
    }
  });
});
