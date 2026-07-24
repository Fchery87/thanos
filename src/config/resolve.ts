import { presetForMode } from "../governance/delivery-overlay";
import { resolveDeliveryState, type ResolvedDelivery } from "../governance/delivery";
import { loadGoalSettings } from "../goal/load-settings";
import { resolveGoalSettings, type GoalSettings } from "../goal/types";
import { yoloDisabledByEnv } from "../permissions/yolo-config";
import { loadPolicyState, type PolicyLoadState } from "../policy/state";
import type { PolicyPreset } from "../policy/types";

export interface ResolveConfigOptions {
  /**
   * Explicit policy file path. Falls through to `loadPolicy`'s own existing
   * precedence when omitted: `HARNESS_POLICY_FILE` env var, then
   * `<cwd>/harness.policy.json`, then the built-in "personal" preset default.
   * See src/policy/loader.ts — this is NOT re-implemented here, only reused.
   */
  policyPath?: string;
}

/**
 * The single typed shape produced by `resolveConfig`. Every field is a
 * pass-through (or a documented, minimal fold) of an existing, already-tested
 * resolver — this type does not introduce any new source of truth.
 */
export interface ResolvedConfig {
  /**
   * Delivery mode/autonomy/gates/merge, per the trust-split in
   * src/governance/delivery.ts: mode/autonomy/yoloLocked come ONLY from the
   * captain registry (`~/.pi/agent/projects.json`, trusted); gates/
   * defaultBranch/merge come from the untrusted ship file
   * (`<repo>/.thanos/delivery.json`) — even if that ship file smuggles in
   * mode/autonomy/yolo keys, they are never read.
   *
   * `yoloLocked`/`yoloAllowed` additionally fold in the `THANOS_YOLO_DISABLED`
   * env override (see src/permissions/yolo-config.ts), matching what
   * src/runtime/register-harness.ts already does today via a separate
   * `permissions.lockYolo()` call — consolidated here into one typed value
   * rather than two call sites. This can only ever make yolo MORE locked,
   * never less: env override > captain registry.
   */
  delivery: ResolvedDelivery;
  /**
   * NOT the active preset — see `policy` below for that. This is purely what
   * docs/governance.md's "Delivery modes" table documents the resolved mode
   * as *implying*, via the existing `presetForMode()` mapping (local-only ->
   * personal, direct-PR -> team, no-mistakes -> ci). Named
   * `presetImpliedByModeDocsOnly` (rather than something parallel-looking to
   * `policy`) specifically so it can't be mistaken for the effective preset
   * at an autocomplete glance.
   *
   * KNOWN GAP (surfaced, not papered over): as currently wired, this value is
   * never applied. The `policy` field below is NOT automatically switched to
   * it — `loadPolicy()` only ever reads the repo's `harness.policy.json` (or
   * `HARNESS_POLICY_FILE`), falling back to a hardcoded "personal" default
   * when neither exists, independent of delivery mode. Only the local-only
   * *overlay* deny rules (git push / gh publish) are actually mode-dependent
   * today (`deliveryPolicyOverlay`, applied later by `GovernanceRuntime`, not
   * by the load path this file composes). See docs/configuration.md for the
   * reconciliation note.
   */
  presetImpliedByModeDocsOnly: PolicyPreset;
  /** The actually-loaded, ACTIVE effective policy (or load error), via `loadPolicyState`. */
  policy: PolicyLoadState;
  /** `/goal` settings, via `loadGoalSettings` merged over `DEFAULT_GOAL_SETTINGS`. */
  goal: GoalSettings;
}

/**
 * One documented entry point over the harness's existing, independently
 * loaded configuration surfaces: delivery (captain registry + ship file),
 * policy (repo file / `HARNESS_POLICY_FILE`), and goal settings
 * (`~/.pi/agent/settings.json`).
 *
 * This is pure consolidation: every value comes from an existing loader
 * (`resolveDeliveryState`, `loadPolicyState`, `loadGoalSettings`) with its
 * existing precedence and trust rules untouched. The only new composition is
 * folding the `THANOS_YOLO_DISABLED` env override into `delivery.yoloLocked`
 * (see `ResolvedConfig.delivery` above), which reflects a union of two
 * existing, already-enforced rules rather than inventing a new one.
 *
 * Fail-safe throughout: `resolveDeliveryState` never throws (falls back to
 * the safe local-only/attended default), and policy load failures surface as
 * `{ kind: "error" }` rather than throwing, so callers can decide how to
 * present a broken `harness.policy.json` instead of crashing.
 */
export async function resolveConfig(
  cwd: string,
  options: ResolveConfigOptions = {},
): Promise<ResolvedConfig> {
  const [deliveryRaw, policy] = await Promise.all([
    resolveDeliveryState(cwd),
    loadPolicyState(cwd, options.policyPath),
  ]);

  const yoloLocked = deliveryRaw.yoloLocked || yoloDisabledByEnv();
  const delivery: ResolvedDelivery = {
    ...deliveryRaw,
    yoloLocked,
    yoloAllowed: !yoloLocked,
  };

  const goal = resolveGoalSettings(loadGoalSettings());

  return {
    delivery,
    presetImpliedByModeDocsOnly: presetForMode(delivery.mode),
    policy,
    goal,
  };
}
