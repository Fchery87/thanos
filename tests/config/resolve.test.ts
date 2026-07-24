import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { resolveConfig } from "../../src/config/resolve";
import { DEFAULT_GOAL_SETTINGS } from "../../src/goal/types";

const SAFE = { mode: "local-only", autonomy: "attended" } as const;

/**
 * Encodes the REAL, currently-implemented precedence (read from
 * src/governance/delivery.ts, src/permissions/yolo-config.ts,
 * src/policy/loader.ts, src/goal/load-settings.ts, and docs/governance.md):
 *
 *   env override  >  captain registry (~/.pi/agent/projects.json, trusted)
 *                 >  untrusted ship file (<repo>/.thanos/delivery.json —
 *                    ONLY gates/defaultBranch/merge; mode/autonomy/yolo are
 *                    never read from it, even if smuggled in)
 *                 >  built-in defaults (local-only/attended, personal preset,
 *                    DEFAULT_GOAL_SETTINGS)
 *
 * `resolveConfig` is a thin orchestrator over the existing
 * `resolveDeliveryState`, `loadPolicyState`, and `loadGoalSettings` — this
 * test exercises the real functions end-to-end via a throwaway HOME/cwd, not
 * mocks, so it proves the trust-split survives composition.
 */
describe("resolveConfig", () => {
  let tmpHome: string;
  let tmpCwd: string;
  let oldHome: string | undefined;
  let oldPolicyFile: string | undefined;
  let oldYoloDisabled: string | undefined;

  beforeEach(async () => {
    oldHome = process.env.HOME;
    oldPolicyFile = process.env.HARNESS_POLICY_FILE;
    oldYoloDisabled = process.env.THANOS_YOLO_DISABLED;
    tmpHome = await mkdtemp(path.join(tmpdir(), "resolve-config-home-"));
    tmpCwd = await mkdtemp(path.join(tmpdir(), "resolve-config-cwd-"));
    process.env.HOME = tmpHome;
    delete process.env.HARNESS_POLICY_FILE;
    delete process.env.THANOS_YOLO_DISABLED;
  });

  afterEach(async () => {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldPolicyFile === undefined) delete process.env.HARNESS_POLICY_FILE;
    else process.env.HARNESS_POLICY_FILE = oldPolicyFile;
    if (oldYoloDisabled === undefined) delete process.env.THANOS_YOLO_DISABLED;
    else process.env.THANOS_YOLO_DISABLED = oldYoloDisabled;
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpCwd, { recursive: true, force: true });
  });

  async function writeRegistry(registry: unknown) {
    await mkdir(path.join(tmpHome, ".pi", "agent"), { recursive: true });
    await writeFile(path.join(tmpHome, ".pi", "agent", "projects.json"), JSON.stringify(registry), "utf-8");
  }

  async function writeShipFile(shipFile: unknown) {
    await mkdir(path.join(tmpCwd, ".thanos"), { recursive: true });
    await writeFile(path.join(tmpCwd, ".thanos", "delivery.json"), JSON.stringify(shipFile), "utf-8");
  }

  // ── Layer 4 (bottom): built-in defaults ─────────────────────────────────
  it("falls back to built-in defaults when nothing is configured", async () => {
    const config = await resolveConfig(tmpCwd);

    expect(config.delivery.mode).toBe("local-only");
    expect(config.delivery.autonomy).toBe("attended");
    expect(config.delivery.gates).toEqual({});
    expect(config.delivery.yoloLocked).toBe(false);
    expect(config.delivery.registered).toBe(false);

    expect(config.policy.kind).toBe("ok");
    if (config.policy.kind === "ok") {
      expect(config.policy.policy.preset).toBe("personal");
    }

    expect(config.goal).toEqual(DEFAULT_GOAL_SETTINGS);
  });

  // ── Layer 2: captain registry beats built-in defaults ───────────────────
  it("captain registry (trusted) overrides the built-in mode/autonomy default", async () => {
    await writeRegistry({
      version: 1,
      default: SAFE,
      projects: [{ path: path.resolve(tmpCwd), mode: "no-mistakes", autonomy: "unattended" }],
    });

    const config = await resolveConfig(tmpCwd);

    expect(config.delivery.mode).toBe("no-mistakes");
    expect(config.delivery.autonomy).toBe("unattended");
    expect(config.delivery.registered).toBe(true);
  });

  // ── Layer 3: untrusted ship file supplies ONLY gates/defaultBranch/merge ─
  it("ship file supplies gates/defaultBranch/merge but is ignored for mode/autonomy/yolo (trust-split)", async () => {
    await writeRegistry({
      version: 1,
      default: SAFE,
      projects: [{ path: path.resolve(tmpCwd), mode: "direct-PR", autonomy: "attended" }],
    });
    await writeShipFile({
      version: 1,
      gates: { test: "bun run test", build: "bun run build" },
      defaultBranch: "release",
      merge: "pr",
      // Smuggled trust-escalation attempt — must be ignored entirely.
      mode: "no-mistakes",
      autonomy: "unattended",
      yolo: "locked-to-off",
    });

    const config = await resolveConfig(tmpCwd);

    // Mechanics from the ship file ARE honored.
    expect(config.delivery.gates).toEqual({ test: "bun run test", build: "bun run build" });
    expect(config.delivery.defaultBranch).toBe("release");
    expect(config.delivery.merge).toBe("pr");
    // Trust fields come ONLY from the registry — the smuggled ship-file
    // values must never win.
    expect(config.delivery.mode).toBe("direct-PR");
    expect(config.delivery.autonomy).toBe("attended");
  });

  it("a ship file cannot escalate trust even with no registry present at all", async () => {
    await writeShipFile({
      version: 1,
      gates: { test: "echo ok" },
      mode: "no-mistakes",
      autonomy: "unattended",
      yolo: "locked-to-off",
    });

    const config = await resolveConfig(tmpCwd);

    // Falls all the way to the safe built-in default; ship file mechanics are
    // still honored, but trust fields collapse to the restrictive default.
    expect(config.delivery.mode).toBe("local-only");
    expect(config.delivery.autonomy).toBe("attended");
    expect(config.delivery.yoloLocked).toBe(false);
    expect(config.delivery.gates).toEqual({ test: "echo ok" });
  });

  // ── Layer 1 (top): env override beats the captain registry ─────────────
  it("THANOS_YOLO_DISABLED=1 (env override) hard-locks yolo even when the registry allows it", async () => {
    await writeRegistry({
      version: 1,
      default: SAFE,
      // No `yolo: "locked"` here — the registry itself permits yolo.
      projects: [{ path: path.resolve(tmpCwd), mode: "direct-PR", autonomy: "attended" }],
    });

    const before = await resolveConfig(tmpCwd);
    expect(before.delivery.yoloLocked).toBe(false);
    expect(before.delivery.yoloAllowed).toBe(true);

    process.env.THANOS_YOLO_DISABLED = "1";
    const after = await resolveConfig(tmpCwd);
    expect(after.delivery.yoloLocked).toBe(true);
    expect(after.delivery.yoloAllowed).toBe(false);
    // The env override does not fabricate a different mode/autonomy — it only
    // locks yolo.
    expect(after.delivery.mode).toBe("direct-PR");
    expect(after.delivery.autonomy).toBe("attended");
  });

  it("registry-level yolo lock and env override compose (either one locks it)", async () => {
    await writeRegistry({
      version: 1,
      default: SAFE,
      projects: [{ path: path.resolve(tmpCwd), mode: "local-only", autonomy: "attended", yolo: "locked" }],
    });

    // Registry alone already locks it.
    const registryLocked = await resolveConfig(tmpCwd);
    expect(registryLocked.delivery.yoloLocked).toBe(true);

    // Adding the env override on top must not un-lock it.
    process.env.THANOS_YOLO_DISABLED = "1";
    const bothLocked = await resolveConfig(tmpCwd);
    expect(bothLocked.delivery.yoloLocked).toBe(true);
  });

  // ── Policy axis: explicit/env file selection, independent precedence ────
  it("HARNESS_POLICY_FILE (env override) selects the effective policy over the repo's harness.policy.json", async () => {
    await writeFile(
      path.join(tmpCwd, "harness.policy.json"),
      JSON.stringify({ version: 1, preset: "team", rules: [], audit: { enabled: true }, headless: { defaultDecision: "deny" } }),
      "utf-8",
    );
    const envPolicyPath = path.join(tmpCwd, "env-policy.json");
    await writeFile(
      envPolicyPath,
      JSON.stringify({ version: 1, preset: "ci", rules: [], audit: { enabled: true }, headless: { defaultDecision: "deny" } }),
      "utf-8",
    );
    process.env.HARNESS_POLICY_FILE = envPolicyPath;

    const config = await resolveConfig(tmpCwd);

    expect(config.policy.kind).toBe("ok");
    if (config.policy.kind === "ok") {
      // The env-pointed file wins over the repo-committed harness.policy.json.
      expect(config.policy.policy.preset).toBe("ci");
    }
  });

  it("an explicit policyPath option outranks the env var", async () => {
    const envPolicyPath = path.join(tmpCwd, "env-policy.json");
    await writeFile(
      envPolicyPath,
      JSON.stringify({ version: 1, preset: "ci", rules: [], audit: { enabled: true }, headless: { defaultDecision: "deny" } }),
      "utf-8",
    );
    process.env.HARNESS_POLICY_FILE = envPolicyPath;

    const explicitPath = path.join(tmpCwd, "explicit-policy.json");
    await writeFile(
      explicitPath,
      JSON.stringify({ version: 1, preset: "team", rules: [], audit: { enabled: true }, headless: { defaultDecision: "deny" } }),
      "utf-8",
    );

    const config = await resolveConfig(tmpCwd, { policyPath: explicitPath });

    expect(config.policy.kind).toBe("ok");
    if (config.policy.kind === "ok") {
      expect(config.policy.policy.preset).toBe("team");
    }
  });

  // ── Settings axis ────────────────────────────────────────────────────────
  it("loads goal settings from ~/.pi/agent/settings.json, merged over defaults", async () => {
    await mkdir(path.join(tmpHome, ".pi", "agent"), { recursive: true });
    await writeFile(
      path.join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ goal: { maxTurns: 99 } }),
      "utf-8",
    );

    const config = await resolveConfig(tmpCwd);

    expect(config.goal.maxTurns).toBe(99);
    // Unspecified fields still fall back to the built-in defaults.
    expect(config.goal.maxTokens).toBe(DEFAULT_GOAL_SETTINGS.maxTokens);
    expect(config.goal.checkpointEvery).toBe(DEFAULT_GOAL_SETTINGS.checkpointEvery);
  });

  // ── Documents the mode -> preset mapping docs/governance.md describes ───
  it("exposes the documented mode -> preset mapping (presetImpliedByModeDocsOnly), independent of the actually-loaded policy", async () => {
    await writeRegistry({
      version: 1,
      default: SAFE,
      projects: [{ path: path.resolve(tmpCwd), mode: "no-mistakes", autonomy: "unattended" }],
    });

    const config = await resolveConfig(tmpCwd);

    // docs/governance.md's table: no-mistakes -> ci. NOT the active preset —
    // the field name makes that explicit so it can't be mistaken for `policy`.
    expect(config.presetImpliedByModeDocsOnly).toBe("ci");
    // KNOWN GAP (see docs/configuration.md): the mode does not currently
    // auto-select the loaded policy's preset — with no harness.policy.json
    // present, the effective policy still falls back to the hardcoded
    // "personal" default regardless of delivery mode. This pins that reality
    // rather than papering over it.
    expect(config.policy.kind).toBe("ok");
    if (config.policy.kind === "ok") {
      expect(config.policy.policy.preset).toBe("personal");
    }
  });
});
