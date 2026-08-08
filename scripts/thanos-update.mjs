#!/usr/bin/env node
// Wrapper around the pi-subagents version pin that makes "moved to an
// incompatible version and silently ran unpatched" unreachable.
//
// Originally built around `pi update --extensions`, on the assumption that
// editing agent/settings.json's pin sets a target `pi update` reconciles
// toward. Running the real cutover against a live install disproved that:
// `updateConfiguredSources` in pi's own package manager filters out any
// package whose spec carries an exact version ("Pinned npm versions are
// fixed", verbatim from its own comment) BEFORE the package is ever
// considered for update — confirmed byte-identical between this repo's
// pinned @earendil-works/pi-coding-agent@0.80.6 devDependency and a live
// 0.83.0 install, so this is what `pi update --extensions` has always done
// for an exact-pinned package, not a version-skew artifact. Since
// pi-subagents is deliberately always exact-pinned, `pi update --extensions`
// can never perform the one operation this wrapper exists for.
//
// The correct mechanism, traced through PackageManager.install() (no
// pinned-skip check there) and confirmed by running it for real:
// `pi install npm:pi-subagents@<version>`. It installs the exact version AND
// atomically replaces the existing agent/settings.json entry (matched by
// package identity, not full spec string — confirmed no duplicate entries
// result). One further empirical finding from that same run: `pi install`
// writes a caret range into agent/npm/package.json even though a raw
// `bun install <pkg>@<version>` reliably writes exact — reproducing it in
// isolated scratch directories with identical argv did not reproduce the
// caret, so the exact cause wasn't pinned down. The fix below doesn't depend
// on understanding why: it defensively re-asserts the exact pin after every
// install, forward or rollback, rather than trusting either tool's default.
//
// scripts/patch-pi-subagents.mjs only applies cleanly when the installed
// version exactly matches PINNED_VERSION in that script; any other version
// makes its `git apply --check` fail. This script treats the patch step as
// part of the version move, not a follow-up: install the pinned target,
// re-apply patches, and if the patches don't apply, install the version that
// was there before (restoring both the binary AND the settings.json pin
// together) and re-patch that — so the operator never ends up on a broken,
// unpatched install, and the pin never drifts from what's actually
// installed. See src/welcome/patch-drift.ts for the sibling piece of logic
// (re-apply after a same-version reinstall wipes files) that this mirrors in
// decision-logic style: status-shaped returns over throwing, all subprocess
// calls injected so the orchestration itself is spawn-free and testable.

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const THANOS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PI_SUBAGENTS_PACKAGE_JSON = join(THANOS_ROOT, "agent", "npm", "node_modules", "pi-subagents", "package.json");
const PI_SUBAGENTS_MANIFEST = join(THANOS_ROOT, "agent", "npm", "package.json");
const PATCH_SCRIPT_PATH = join(THANOS_ROOT, "scripts", "patch-pi-subagents.mjs");

// agent/settings.json is gitignored, single-machine live config — same file
// src/welcome/pin-assertion.ts reads. Duplicated rather than cross-imported:
// this is a plain .mjs script, that's TypeScript under src/, and pin-
// assertion.ts's own comment already declined to add a shared abstraction
// for this exact one-line path join.
function defaultSettingsPath() {
  const home = homedir();
  return home ? join(home, ".pi", "agent", "settings.json") : join(THANOS_ROOT, "agent", "settings.json");
}

const DELEGATION_PACKAGE = "pi-subagents";
const EXACT_VERSION = /@(\d+\.\d+\.\d+)$/;

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
 * `installPinned` is used for both the forward move and the rollback — this
 * is what keeps agent/settings.json's pin and the actual installed version
 * from drifting apart at any step, including mid-rollback: a rollback that
 * only restored the binary (not the pin) would leave settings.json claiming
 * a version that isn't actually installed, exactly the drift
 * src/welcome/pin-assertion.ts exists to warn about elsewhere.
 *
 * @param {{
 *   readVersion: () => Promise<string>,
 *   readPinnedTarget: () => Promise<string>,
 *   installPinned: (version: string) => Promise<{ code: number }>,
 *   runPatchScript: () => Promise<{ code: number }>,
 * }} deps
 * @returns {Promise<
 *   | { status: "updated"; from: string; to: string }
 *   | { status: "unchanged" }
 *   | { status: "install-failed" }
 *   | { status: "rolled-back"; from: string }
 *   | { status: "broken"; from: string }
 * >}
 */
export async function planUpdate(deps) {
  const before = await deps.readVersion();
  const target = await deps.readPinnedTarget();

  if (target !== before) {
    const installResult = await deps.installPinned(target);
    if (installResult.code !== 0) {
      // Nothing confirmed to have moved — no point re-running the patch
      // script, and nothing to roll back.
      return { status: "install-failed" };
    }
  }

  const patchResult = await deps.runPatchScript();
  if (patchResult.code === 0) {
    return target === before ? { status: "unchanged" } : { status: "updated", from: before, to: target };
  }

  // Patches don't apply against the target version. Put the previously-
  // installed version back — through the same installPinned path, so the
  // settings.json pin is restored along with the binary, not just the binary.
  const rollbackResult = await deps.installPinned(before);
  if (rollbackResult.code !== 0) {
    // Restoring the known-good version failed too — this needs a human, not
    // another automatic retry. Nothing to re-patch: the rollback itself
    // never landed.
    return { status: "broken", from: before };
  }

  // Restoring `before` reinstalls the source tree the patch artifact was
  // last verified against, but that is necessary, not sufficient — it does
  // not by itself prove the patches actually apply to what landed on disk
  // (a partial install, a corrupted patch artifact, or drift in node_modules
  // could all make this re-patch fail too). Mirrors the same posture
  // src/welcome/patch-drift.ts's reapplyPatchesIfVersionMatches takes toward
  // its own patch script's exit code: re-verify, don't trust. Gating
  // "rolled-back" on the install call's exit code alone would let this
  // function report success while the harness is still unpatched — exactly
  // the state this whole wrapper exists to make unreachable.
  const rollbackPatchResult = await deps.runPatchScript();
  if (rollbackPatchResult.code !== 0) {
    return { status: "broken", from: before };
  }
  return { status: "rolled-back", from: before };
}

// --- Real effects, used only by main() ------------------------------------

async function readInstalledVersion() {
  const manifest = JSON.parse(await readFile(PI_SUBAGENTS_PACKAGE_JSON, "utf-8"));
  if (typeof manifest.version !== "string") {
    throw new Error(`${PI_SUBAGENTS_PACKAGE_JSON} has no readable "version" field`);
  }
  return manifest.version;
}

/**
 * Spawn a command with output relayed live, resolving with its exit code.
 * Resolves (never rejects) even when `spawn` itself fails synchronously
 * (bad command, ENOENT) — planUpdate's contract is that every injected
 * effect resolves to `{ code }`, so a spawn failure has to look like a
 * normal non-zero exit to the caller rather than an uncaught rejection that
 * would skip past the "broken" status's deliberately-detailed recovery
 * message and land in main()'s generic outer catch instead.
 */
export function spawnRelay(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", cwd: THANOS_ROOT, ...options });
    child.on("error", () => resolve({ code: 1 }));
    child.on("close", (code) => resolve({ code: code ?? 1 }));
  });
}

async function readPinnedTargetReal() {
  const settingsPath = defaultSettingsPath();
  const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  for (const entry of packages) {
    if (typeof entry !== "string" || !entry.startsWith(`npm:${DELEGATION_PACKAGE}`)) continue;
    const tail = entry.slice(`npm:${DELEGATION_PACKAGE}`.length);
    if (tail !== "" && !tail.startsWith("@")) continue;
    const match = EXACT_VERSION.exec(entry);
    if (match) return match[1];
    throw new Error(`${settingsPath} pins ${DELEGATION_PACKAGE} without an exact version ("${entry}")`);
  }
  throw new Error(`${settingsPath} has no ${DELEGATION_PACKAGE} entry under "packages"`);
}

/**
 * Rewrites agent/npm/package.json's pi-subagents dependency to the bare
 * exact version string. `pi install` was observed writing a caret range
 * there even though a raw `bun install <pkg>@<version>` reliably writes
 * exact — the cause wasn't pinned down (isolated scratch-directory repros
 * with identical argv didn't reproduce it), so this re-asserts the pin
 * unconditionally afterward rather than trusting either tool's default.
 */
async function reassertExactManifestPin(version) {
  const manifest = JSON.parse(await readFile(PI_SUBAGENTS_MANIFEST, "utf-8"));
  if (manifest.dependencies?.[DELEGATION_PACKAGE] === version) return;
  manifest.dependencies = { ...manifest.dependencies, [DELEGATION_PACKAGE]: version };
  await writeFile(PI_SUBAGENTS_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

async function installPinnedReal(version) {
  const result = await spawnRelay("pi", ["install", `npm:${DELEGATION_PACKAGE}@${version}`]);
  if (result.code !== 0) return result;
  try {
    await reassertExactManifestPin(version);
  } catch (err) {
    console.error(
      `[thanos-update] pi install succeeded but re-pinning ${PI_SUBAGENTS_MANIFEST} failed: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return { code: 1 };
  }
  return { code: 0 };
}

async function runPatchScriptReal() {
  return spawnRelay(process.execPath, [PATCH_SCRIPT_PATH]);
}

async function main() {
  const result = await planUpdate({
    readVersion: readInstalledVersion,
    readPinnedTarget: readPinnedTargetReal,
    installPinned: installPinnedReal,
    runPatchScript: runPatchScriptReal,
  });

  switch (result.status) {
    case "updated":
      console.log(`[thanos-update] updated pi-subagents ${result.from} -> ${result.to}; patches re-applied cleanly.`);
      process.exit(0);
      break;
    case "unchanged":
      console.log("[thanos-update] pi-subagents is already at its pinned version; patches still hold.");
      process.exit(0);
      break;
    case "install-failed":
      console.error("[thanos-update] `pi install` failed to reach the pinned version. Nothing was rolled back.");
      process.exit(1);
      break;
    case "rolled-back":
      console.warn(
        `[thanos-update] the pinned version's patches did not apply. Rolled back to the ` +
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
          `  2. Reinstall the known-good version: pi install npm:pi-subagents@${result.from}\n` +
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
