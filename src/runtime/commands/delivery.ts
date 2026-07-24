import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionManager } from "../../permissions/manager";
import {
  loadRegistry, readRepoId, resolveDeliveryState,
  type DeliveryMode, type ResolvedDelivery,
} from "../../governance/delivery";
import { deliveryPolicyOverlay } from "../../governance/delivery-overlay";
import { DELIVERY_MODE_HELP, DELIVERY_MODES, saveRegistry, upsertRegistryEntry } from "../../governance/delivery-select";
import type { PolicyRule } from "../../policy/types";
import { noopTheme } from "../../ui-utils";

/**
 * Owns the session's resolved delivery state (mode/autonomy) and its derived
 * policy overlay, both of which the first-launch selector, /delivery, and
 * /yolo can swap mid-session via applySelection() — a granted mode then
 * takes effect immediately, without a restart. One instance per
 * registerHarness() call; session_start, the tool_call governance gate, and
 * every command below read it through getState()/getOverlay() rather than
 * a raw `let` so a swap is visible everywhere at once.
 */
export class DeliveryRuntime {
  private statePromise: Promise<ResolvedDelivery>;
  private overlayPromise: Promise<PolicyRule[]>;

  constructor(cwd: string) {
    // Resolved in BOTH parent and child processes. A subagent's cwd is a
    // worktree of the same repo (shared git remote), so it matches the same
    // registry entry — giving children the same delivery overlay (e.g.
    // local-only push-deny) AND the repo's autonomy. This is what lets
    // unattended repos run headless subagents while attended/unregistered
    // repos correctly fail closed (writer subagents stall with no UI rather
    // than auto-acting). resolveDeliveryState is fail-safe (never throws).
    // CAVEAT: the registry match is by git REMOTE. A registry entry keyed
    // only by `path` (no `match`/remote), or a repo with no `origin`, won't
    // match for a subagent (its cwd is the worktree path), so it falls back
    // to the safe default (local-only/attended) — fail-safe, but path-only
    // entries don't propagate to subagents.
    this.statePromise = resolveDeliveryState(cwd);
    // The overlay is derived once per RESOLUTION, not per tool call.
    this.overlayPromise = this.statePromise.then((d) => deliveryPolicyOverlay(d.mode));
  }

  getState(): Promise<ResolvedDelivery> {
    return this.statePromise;
  }

  getOverlay(): Promise<PolicyRule[]> {
    return this.overlayPromise;
  }

  static statusLabel(d: ResolvedDelivery): string {
    return `mode:${d.mode}${d.autonomy === "unattended" ? " ⚙ unattended" : ""}`;
  }

  /** Show the delivery-mode picker. Returns undefined when dismissed (fail-closed). */
  async promptMode(ctx: ExtensionContext, repoLabel: string): Promise<DeliveryMode | undefined> {
    const options = DELIVERY_MODES.map((m) => `${m} — ${DELIVERY_MODE_HELP[m]}`);
    const choice = await ctx.ui.select(`New project: ${repoLabel} — choose a delivery mode`, options);
    if (!choice) return undefined;
    return DELIVERY_MODES.find((m) => choice.startsWith(m));
  }

  /**
   * Persist a selector choice to the trusted registry, then swap the LIVE
   * session's delivery state (mode overlay, yolo lock, status segment) so the
   * grant applies immediately. Throws on persistence failure — callers surface
   * it rather than letting the session believe the grant stuck.
   */
  async applySelection(ctx: ExtensionContext, mode: DeliveryMode, permissions: PermissionManager): Promise<void> {
    const repoId = await readRepoId(process.cwd());
    await saveRegistry(upsertRegistryEntry(await loadRegistry(), repoId, mode));
    const next = await resolveDeliveryState(process.cwd());
    this.statePromise = Promise.resolve(next);
    this.overlayPromise = Promise.resolve(deliveryPolicyOverlay(next.mode));
    if (next.yoloLocked) permissions.lockYolo();
    const theme = ctx.ui.theme ?? noopTheme;
    ctx.ui.setStatus("harness-delivery", theme.fg("accent", DeliveryRuntime.statusLabel(next)));
    ctx.ui.notify(
      `Delivery mode for ${repoId.remote ?? repoId.path}: ${next.mode} (saved to ~/.pi/agent/projects.json — /delivery to change)`,
      "info",
    );
  }
}

export interface DeliveryCommandDeps {
  isSubagent: boolean;
  runtime: DeliveryRuntime;
  permissions: PermissionManager;
}

/** /delivery — choose the delivery mode for this project (persisted). */
export function registerDeliveryCommand(pi: ExtensionAPI, deps: DeliveryCommandDeps): void {
  pi.registerCommand("delivery", {
    description: "Choose the delivery mode for this project (persists to ~/.pi/agent/projects.json)",
    getArgumentCompletions: (prefix) => {
      const filtered = (DELIVERY_MODES as readonly string[]).filter((mode) => mode.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      if (deps.isSubagent) {
        ctx.ui.notify("/delivery is only available in the main session.", "warning");
        return;
      }
      const trimmed = args.trim();
      const explicit = (DELIVERY_MODES as readonly string[]).includes(trimmed)
        ? (trimmed as DeliveryMode)
        : undefined;
      if (trimmed && !explicit) {
        ctx.ui.notify(
          `Unknown delivery mode "${trimmed}" — expected one of: ${DELIVERY_MODES.join(", ")}`,
          "warning",
        );
        return;
      }
      if (!ctx.hasUI && !explicit) {
        ctx.ui.notify("The delivery selector requires an interactive UI (or pass a mode: /delivery direct-PR)", "warning");
        return;
      }

      let mode = explicit;
      if (!mode) {
        const repoId = await readRepoId(process.cwd());
        mode = await deps.runtime.promptMode(ctx, repoId.remote ?? repoId.path);
      }
      if (!mode) return;
      try {
        await deps.runtime.applySelection(ctx, mode, deps.permissions);
      } catch (err) {
        ctx.ui.notify(
          `Failed to save delivery mode: ${err instanceof Error ? err.message : String(err)}`,
          "warning",
        );
      }
    },
  });
}
