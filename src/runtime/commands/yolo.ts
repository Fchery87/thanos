import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PermissionManager } from "../../permissions/manager";
import type { ResolvedDelivery } from "../../governance/delivery";
import { formatPanel } from "../../ui-utils";

export interface YoloCommandDeps {
  permissions: PermissionManager;
  // A getter, not a bare Promise: deliveryStatePromise is reassigned in place
  // (see applyDeliverySelection in commands/delivery.ts) whenever /delivery
  // or the first-launch selector persists a new mode. Capturing the Promise
  // by value at registration time would freeze this command onto whatever
  // delivery state existed at register() time — a live getter reads the
  // current binding on every invocation instead.
  getDeliveryState: () => Promise<ResolvedDelivery | undefined>;
}

/** /yolo — toggle yolo mode (bypass all permission checks/policy gating). */
export function registerYoloCommand(pi: ExtensionAPI, deps: YoloCommandDeps): void {
  pi.registerCommand("yolo", {
    description: "Toggle yolo mode — skips all permission prompts and policy checks.",
    handler: async (_args, ctx) => {
      if (deps.permissions.yoloLocked) {
        ctx.ui.notify("Yolo is disabled by configuration.", "warning");
        return;
      }

      const delivery = await deps.getDeliveryState();
      if (delivery?.autonomy === "unattended") {
        ctx.ui.notify("Yolo is not available in unattended autonomy mode.", "warning");
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify("Yolo requires an interactive UI.", "warning");
        return;
      }

      const theme = ctx.ui.theme;
      const current = deps.permissions.isYolo;

      if (!current) {
        // Require explicit confirmation before enabling. Yolo bypasses
        // permission prompts and risk gating in every delivery mode, but the
        // immutable protection floor still applies — explicit policy denies,
        // local-only egress/push guards, and Lens Lite secret scanning.
        const ok = await ctx.ui.confirm(
          "Enable Yolo Mode?",
          "Permission prompts and risk gating will be bypassed for this session.\n" +
          "Explicit policy denies, local-only egress guards, and secret scanning still apply.\n" +
          "The agent will execute any tool without asking. Use in trusted environments only.",
        );
        if (!ok) {
          ctx.ui.notify("Yolo mode not enabled.", "info");
          return;
        }
        deps.permissions.setYolo(true);
        ctx.ui.setStatus("harness-yolo", theme.fg("error", "⚡ yolo"));
        ctx.ui.notify(
          formatPanel(theme, "Yolo Mode ON", [
            theme.fg("warning", "All permission checks are now bypassed."),
            theme.fg("dim", "Run /yolo again to restore normal permission behavior."),
          ], "warning"),
          "warning",
        );
      } else {
        deps.permissions.setYolo(false);
        ctx.ui.setStatus("harness-yolo", undefined);
        ctx.ui.notify(
          formatPanel(theme, "Yolo Mode OFF", "Permission checks restored.", "dim"),
          "info",
        );
      }
    },
  });
}

/**
 * ctrl+shift+y — same toggle, exposed as a shortcut. Deliberately NOT unified
 * with the /yolo command above: it skips the unattended-autonomy and hasUI
 * checks (shortcuts are keyboard-only, so hasUI is implicitly true; the
 * autonomy check was never applied here either) — preserved as-is from the
 * pre-decomposition behavior rather than changed to match.
 */
export function registerYoloShortcut(pi: ExtensionAPI, permissions: PermissionManager): void {
  pi.registerShortcut("ctrl+shift+y", {
    description: "Toggle yolo mode — bypass all permission checks",
    handler: async (ctx) => {
      if (permissions.yoloLocked) {
        ctx.ui.notify("Yolo is disabled by configuration.", "warning");
        return;
      }
      const theme = ctx.ui.theme;
      if (!permissions.isYolo) {
        const ok = await ctx.ui.confirm(
          "Enable Yolo Mode?",
          "All permission checks, policy rules, and confirmation prompts will be bypassed.\n" +
          "The agent will execute any tool without asking. Use in trusted environments only.",
        );
        if (!ok) return;
        permissions.setYolo(true);
        ctx.ui.setStatus("harness-yolo", theme.fg("error", "⚡ yolo"));
        ctx.ui.notify(
          formatPanel(theme, "Yolo Mode ON", [
            theme.fg("warning", "All permission checks are now bypassed."),
            theme.fg("dim", "Press Ctrl+Shift+Y again to restore normal behavior."),
          ], "warning"),
          "warning",
        );
      } else {
        permissions.setYolo(false);
        ctx.ui.setStatus("harness-yolo", undefined);
        ctx.ui.notify(formatPanel(theme, "Yolo Mode OFF", "Permission checks restored.", "dim"), "info");
      }
    },
  });
}
