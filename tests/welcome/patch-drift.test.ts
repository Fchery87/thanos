import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkPatchDrift,
  formatPatchDriftWarning,
  formatPatchRepairNotice,
  PATCH_TARGETS,
  repairPatchDrift,
} from "../../src/welcome/patch-drift";

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

  it("reports no missing markers when every patch is present", async () => {
    const root = await makeInstallRoot();
    await writePatchTargets(root, PATCH_TARGETS.map(() => true));
    const result = await checkPatchDrift(root);
    expect(result).toEqual({ installed: true, missingMarkers: [] });
  });

  it("reports the specific marker missing when a patch reverted", async () => {
    const root = await makeInstallRoot();
    // Only the last target reverts; the rest stay patched. Written against
    // PATCH_TARGETS' length rather than a hardcoded [true, false] so retiring
    // or adding a patch does not silently turn this into a different test.
    const last = PATCH_TARGETS.length - 1;
    await writePatchTargets(
      root,
      PATCH_TARGETS.map((_, i) => i !== last),
    );
    const result = await checkPatchDrift(root);
    expect(result.installed).toBe(true);
    expect(result.missingMarkers).toEqual([PATCH_TARGETS[last].marker]);
  });

  it("reports every marker missing when all patches reverted", async () => {
    const root = await makeInstallRoot();
    await writePatchTargets(root, PATCH_TARGETS.map(() => false));
    const result = await checkPatchDrift(root);
    expect(result.installed).toBe(true);
    expect(result.missingMarkers).toEqual(PATCH_TARGETS.map((t) => t.marker));
  });

  it("treats an installed package whose patch target file itself is missing as a missing marker", async () => {
    const root = await makeInstallRoot();
    // Write every target file except the last, which is absent entirely
    // (e.g. pi-subagents restructured its file layout).
    const last = PATCH_TARGETS.length - 1;
    for (const target of PATCH_TARGETS.slice(0, last)) {
      const filePath = join(root, target.file);
      await mkdir(join(filePath, ".."), { recursive: true });
      await writeFile(filePath, `// ${target.marker}\n`, "utf-8");
    }

    const result = await checkPatchDrift(root);
    expect(result.installed).toBe(true);
    expect(result.missingMarkers).toEqual([PATCH_TARGETS[last].marker]);
  });
});

/**
 * Builds a stand-in for scripts/patch-pi-subagents.mjs. The real script is
 * spawned rather than reimplemented, so these tests drive that seam with a
 * script whose behaviour they control — never the real one, which would write
 * into the machine's actual pi-subagents install.
 */
async function writeFakePatchScript(
  root: string,
  opts: { writesMarkers: boolean; exitCode?: number },
): Promise<string> {
  const scriptPath = join(root, "fake-patch.mjs");
  const body = opts.writesMarkers
    ? `import { writeFileSync } from "node:fs";\n` +
      PATCH_TARGETS.map(
        (t) =>
          `writeFileSync(${JSON.stringify(join(root, t.file))}, "// patched\\n// ${t.marker}\\n", "utf-8");`,
      ).join("\n") +
      `\nprocess.exit(${opts.exitCode ?? 0});\n`
    : `process.exit(${opts.exitCode ?? 0});\n`;
  await writeFile(scriptPath, body, "utf-8");
  return scriptPath;
}

describe("repairPatchDrift", () => {
  it("re-applies a reverted patch and reports success", async () => {
    const root = await makeInstallRoot();
    await writePatchTargets(root, PATCH_TARGETS.map(() => false));
    const script = await writeFakePatchScript(root, { writesMarkers: true });

    const result = await repairPatchDrift(root, script);
    expect(result).toEqual({ repaired: true, stillMissing: [] });
    // The markers really are on disk now, not just reported as fixed.
    expect((await checkPatchDrift(root)).missingMarkers).toEqual([]);
  });

  it("reports the markers still missing when the script cannot fix them", async () => {
    const root = await makeInstallRoot();
    await writePatchTargets(root, PATCH_TARGETS.map(() => false));
    const script = await writeFakePatchScript(root, { writesMarkers: false, exitCode: 1 });

    const result = await repairPatchDrift(root, script);
    expect(result.repaired).toBe(false);
    expect(result.benign).toBeFalsy();
    expect(result.stillMissing).toEqual(PATCH_TARGETS.map((t) => t.marker));
  });

  it("treats an unfixable patch as benign when the script's probe still exits clean", async () => {
    // Upstream absorbed the fix: the marker can never be re-applied, but the
    // script's behavioural probe passes, so it exits 0. Without the benign flag
    // this state would warn on every session start forever.
    const root = await makeInstallRoot();
    await writePatchTargets(root, PATCH_TARGETS.map(() => false));
    const script = await writeFakePatchScript(root, { writesMarkers: false, exitCode: 0 });

    const result = await repairPatchDrift(root, script);
    expect(result.repaired).toBe(false);
    expect(result.benign).toBe(true);
    expect(result.stillMissing).toEqual(PATCH_TARGETS.map((t) => t.marker));
  });

  it("trusts the tree over the exit code when a non-zero run still repaired it", async () => {
    // The script exits non-zero for reasons unrelated to whether the patch
    // landed (e.g. an older version that failed one obsolete patch while
    // applying another). Re-checking the files is what decides.
    const root = await makeInstallRoot();
    await writePatchTargets(root, PATCH_TARGETS.map(() => false));
    const script = await writeFakePatchScript(root, { writesMarkers: true, exitCode: 1 });

    const result = await repairPatchDrift(root, script);
    expect(result).toEqual({ repaired: true, stillMissing: [] });
  });

  it("does not throw when the patch script is missing entirely", async () => {
    const root = await makeInstallRoot();
    await writePatchTargets(root, PATCH_TARGETS.map(() => false));

    const result = await repairPatchDrift(root, join(root, "no-such-script.mjs"));
    expect(result.repaired).toBe(false);
    expect(result.reason).toContain("no-such-script.mjs");
    // Regression guard: this branch used to hardcode [], which rendered a
    // self-contradictory "(0/N)" warning naming no markers.
    expect(result.stillMissing).toEqual(PATCH_TARGETS.map((t) => t.marker));
    expect(result.benign).toBeFalsy();
  });
});

describe("formatPatchRepairNotice", () => {
  const missing = { installed: true, missingMarkers: [PATCH_TARGETS[0].marker] };

  it("returns undefined when there was no drift to repair", () => {
    const notice = formatPatchRepairNotice(
      { installed: true, missingMarkers: [] },
      { repaired: true, stillMissing: [] },
    );
    expect(notice).toBeUndefined();
  });

  it("returns undefined when pi-subagents is not installed", () => {
    const notice = formatPatchRepairNotice(
      { installed: false, missingMarkers: [] },
      { repaired: true, stillMissing: [] },
    );
    expect(notice).toBeUndefined();
  });

  it("stays silent when the patch is obsolete but pi-subagents is verified healthy", () => {
    // Regression guard: this state persists forever, so a notice here would nag
    // on every session start — the same false alarm this design removed.
    const notice = formatPatchRepairNotice(missing, {
      repaired: false,
      stillMissing: [PATCH_TARGETS[0].marker],
      benign: true,
    });
    expect(notice).toBeUndefined();
  });

  it("reports a successful automatic repair as info, not a warning", () => {
    const notice = formatPatchRepairNotice(missing, { repaired: true, stillMissing: [] });
    expect(notice?.level).toBe("info");
    expect(notice?.message).toContain("re-applied automatically");
  });

  it("warns with the manual command and the reason when repair failed", () => {
    const notice = formatPatchRepairNotice(
      missing,
      { repaired: false, stillMissing: [PATCH_TARGETS[0].marker], reason: "spawn failed" },
      "/custom/dir/scripts/patch-pi-subagents.mjs",
    );
    expect(notice?.level).toBe("warning");
    expect(notice?.message).toContain(PATCH_TARGETS[0].marker);
    expect(notice?.message).toContain("spawn failed");
    expect(notice?.message).toContain("/custom/dir/scripts/patch-pi-subagents.mjs");
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
