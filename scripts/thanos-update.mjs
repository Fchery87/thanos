#!/usr/bin/env node
// Wrapper around `pi update --extensions` that makes "moved to an
// incompatible pi-subagents version and silently ran unpatched" unreachable.
//
// `pi update --extensions` reinstalls pi-subagents from npm. scripts/patch-
// pi-subagents.mjs only applies cleanly when the installed version exactly
// matches PINNED_VERSION in that script; any other version makes its
// `git apply --check` fail. Left alone, that failure is silent from the
// operator's point of view: the update "succeeds" and the harness keeps
// running against unpatched code.
//
// This script closes that gap by treating the patch step as part of the
// update, not a follow-up: run `pi update`, re-apply patches, and if the
// patches don't apply, reinstall the version that was there before the
// update and re-patch that — so the operator never ends up on a broken,
// unpatched install. See src/welcome/patch-drift.ts for the sibling piece of
// logic (re-apply after a same-version reinstall wipes files) that this
// mirrors in decision-logic style: status-shaped returns over throwing, all
// subprocess calls injected so the orchestration itself is spawn-free and
// testable.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const THANOS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PI_SUBAGENTS_PACKAGE_JSON = join(THANOS_ROOT, "agent", "npm", "node_modules", "pi-subagents", "package.json");
const PATCH_SCRIPT_PATH = join(THANOS_ROOT, "scripts", "patch-pi-subagents.mjs");

// Same "importable without side effects" guard as scripts/patch-pi-subagents.mjs:
// this module is spawned as a subprocess in the real path (`node
// scripts/thanos-update.mjs`) but imported directly by tests, which want
// planUpdate's decision logic without any real subprocess or process.exit.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

/**
 * Pure orchestration over injected effects — no subprocess spawning happens
 * in here, all of it goes through `deps`. See the bottom of this file for
 * the real effects used by `main()`.
 *
 * @param {{
 *   readVersion: () => Promise<string>,
 *   runPiUpdate: () => Promise<{ code: number }>,
 *   runPatchScript: () => Promise<{ code: number }>,
 *   reinstall: (version: string) => Promise<{ code: number }>,
 * }} deps
 * @returns {Promise<
 *   | { status: "updated"; from: string; to: string }
 *   | { status: "unchanged" }
 *   | { status: "update-failed" }
 *   | { status: "rolled-back"; from: string }
 *   | { status: "broken"; from: string }
 * >}
 */
export async function planUpdate(deps) {
  const before = await deps.readVersion();

  const updateResult = await deps.runPiUpdate();
  if (updateResult.code !== 0) {
    // Nothing moved — pi's own update step never completed, so there is
    // nothing to roll back and no point re-running the patch script.
    return { status: "update-failed" };
  }

  const patchResult = await deps.runPatchScript();
  if (patchResult.code === 0) {
    const after = await deps.readVersion();
    return after === before ? { status: "unchanged" } : { status: "updated", from: before, to: after };
  }

  // Patches no longer apply against whatever `pi update` just installed.
  // Put the previously-installed version back and re-patch that.
  const reinstallResult = await deps.reinstall(before);
  if (reinstallResult.code !== 0) {
    // Reinstalling the known-good version failed too — this needs a human,
    // not another automatic retry. Nothing to re-patch: the rollback itself
    // never landed.
    return { status: "broken", from: before };
  }

  // Reinstalling `before` restores the source tree the patch artifact was
  // last verified against, but that is necessary, not sufficient — it does
  // not by itself prove the patches actually apply to what landed on disk
  // (a partial install, a corrupted patch artifact, or drift in node_modules
  // could all make this re-patch fail too). Mirrors the same posture
  // src/welcome/patch-drift.ts's reapplyPatchesIfVersionMatches takes toward
  // its own patch script's exit code: re-verify, don't trust. Gating
  // "rolled-back" on reinstall's exit code alone would let this function
  // report success while the harness is still unpatched — exactly the state
  // this whole wrapper exists to make unreachable.
  const rollbackPatchResult = await deps.runPatchScript();
  if (rollbackPatchResult.code !== 0) {
    return { status: "broken", from: before };
  }
  return { status: "rolled-back", from: before };
}

// --- Real effects, used only by main() ------------------------------------

async function readInstalledVersion() {
  const manifest = JSON.parse(await readFile(PI_SUBAGENTS_PACKAGE_JSON, "utf-8"));
  return manifest.version;
}

/** Spawn a command with output relayed live, resolving with its exit code. */
function spawnRelay(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", cwd: THANOS_ROOT, ...options });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1 }));
  });
}

async function runPiUpdateReal() {
  return spawnRelay("pi", ["update", "--extensions"]);
}

async function reinstallReal(version) {
  // Exact argv shape pi's own package manager uses for npm-sourced updates —
  // verified separately, not to be second-guessed here.
  return spawnRelay("bun", ["install", `pi-subagents@${version}`, "--cwd", "agent/npm", "--omit=peer"]);
}

async function runPatchScriptReal() {
  return spawnRelay(process.execPath, [PATCH_SCRIPT_PATH]);
}

async function main() {
  const result = await planUpdate({
    readVersion: readInstalledVersion,
    runPiUpdate: runPiUpdateReal,
    runPatchScript: runPatchScriptReal,
    reinstall: reinstallReal,
  });

  switch (result.status) {
    case "updated":
      console.log(`[thanos-update] updated pi-subagents ${result.from} -> ${result.to}; patches re-applied cleanly.`);
      process.exit(0);
      break;
    case "unchanged":
      console.log("[thanos-update] pi update ran but the installed pi-subagents version did not change; patches still hold.");
      process.exit(0);
      break;
    case "update-failed":
      console.error("[thanos-update] `pi update --extensions` failed. Nothing was reinstalled or rolled back.");
      process.exit(1);
      break;
    case "rolled-back":
      console.warn(
        `[thanos-update] pi update moved to a version whose patches did not apply. Rolled back to the ` +
          `previously-installed pi-subagents ${result.from} and re-applied patches successfully. ` +
          `The update did NOT take effect — investigate the patch artifact before retrying.`,
      );
      process.exit(0);
      break;
    case "broken":
      console.error(
        `[thanos-update] pi-subagents patches failed to apply after the update, AND rolling back to the ` +
          `previously-installed version ${result.from} also failed. This needs manual repair:\n` +
          `  1. Check what version of pi-subagents is currently installed.\n` +
          `  2. Reinstall the known-good version: bun install pi-subagents@${result.from} --cwd agent/npm --omit=peer\n` +
          `  3. Re-run the patch script by hand: node scripts/patch-pi-subagents.mjs`,
      );
      process.exit(1);
      break;
  }
}

if (isMainModule) {
  main().catch((err) => {
    console.error("[thanos-update] unexpected failure:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
