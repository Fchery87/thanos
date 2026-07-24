import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fastForwardMerge, getCurrentBranch } from "../../governance/ff-merge";
import { formatPanel, noopTheme } from "../../ui-utils";
import type { DeliveryRuntime } from "./delivery";

/** Human-readable list of gate names for /ship prompts ("none" when empty). */
function formatGateNames(gates: Record<string, string | null>): string {
  const names = Object.keys(gates);
  return names.length > 0 ? names.join(", ") : "none";
}

export interface ShipCommandDeps {
  isSubagent: boolean;
  runtime: DeliveryRuntime;
}

/** /ship — deliver the current branch per the resolved delivery mode. */
export function registerShipCommand(pi: ExtensionAPI, deps: ShipCommandDeps): void {
  pi.registerCommand("ship", {
    description: "Ship the current branch per delivery mode (local-only: fast-forward merge into the default branch).",
    handler: async (_args, ctx) => {
      const theme = ctx.ui.theme ?? noopTheme;

      if (deps.isSubagent) {
        ctx.ui.notify("/ship is only available in the main session.", "warning");
        return;
      }

      const delivery = await deps.runtime.getState();

      const currentBranch = await getCurrentBranch(process.cwd());
      if (!currentBranch) {
        ctx.ui.notify(
          formatPanel(theme, "Ship Failed", "Could not determine the current branch (detached HEAD or not a git repo?).", "error"),
          "warning",
        );
        return;
      }

      const target = delivery.defaultBranch;

      // direct-PR / no-mistakes: Thanos does not push in v1. Hand the PR step back.
      if (delivery.mode !== "local-only") {
        ctx.ui.notify(
          formatPanel(theme, `Ship — ${delivery.mode}`, [
            theme.fg("dim", `Thanos does not push or open PRs in v1 (mode: ${delivery.mode}).`),
            `Confirm gates are green on ${theme.fg("accent", currentBranch)}, then push / open the PR yourself.`,
            theme.fg("dim", `Gates: ${formatGateNames(delivery.gates)}`),
          ], "accent"),
          "info",
        );
        return;
      }

      // Defensive: the ship file may request a non-fast-forward merge. Thanos
      // only ever fast-forwards in v1, so make that explicit instead of silently
      // fast-forwarding against the file's intent.
      if (delivery.merge !== "fast-forward") {
        ctx.ui.notify(
          formatPanel(theme, "Ship Not Performed", [
            theme.fg("dim", `The ship file requests a "${delivery.merge}" merge, which Thanos does not perform in v1.`),
            `Merge ${theme.fg("accent", currentBranch)} into ${theme.fg("accent", target)} yourself.`,
          ], "warning"),
          "warning",
        );
        return;
      }

      // local-only: fast-forward merge of the current branch into the default branch.
      if (currentBranch === target) {
        ctx.ui.notify(
          formatPanel(theme, "Nothing to Ship", `You are already on ${theme.fg("accent", target)}; switch to a feature branch first.`, "warning"),
          "warning",
        );
        return;
      }

      // Gate verification: require an explicit human confirmation that gates are
      // green before mutating the local default branch. This is the simpler,
      // robust option vs. re-running arbitrary repo-defined gate commands here.
      if (!ctx.hasUI) {
        ctx.ui.notify(
          formatPanel(theme, "Ship Needs Confirmation", "/ship requires an interactive UI to confirm gates before merging.", "warning"),
          "warning",
        );
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Gates green?",
        `Confirm all required gates passed, then fast-forward merge ${currentBranch} into ${target}.\n` +
        `Gates: ${formatGateNames(delivery.gates)}\n` +
        "Thanos will NOT push — this only advances your local default branch.",
      );
      if (!confirmed) {
        ctx.ui.notify("Ship cancelled.", "info");
        return;
      }

      const result = await fastForwardMerge(process.cwd(), currentBranch, target);
      if (result.ok) {
        ctx.ui.notify(
          formatPanel(theme, "Shipped", [
            `${theme.fg("success", currentBranch)} fast-forwarded into ${theme.fg("accent", target)} (local only).`,
            theme.fg("dim", "No push was performed — push when you are ready."),
          ], "dim"),
          "info",
        );
      } else {
        ctx.ui.notify(
          formatPanel(theme, "Ship Failed", [
            `Could not fast-forward ${theme.fg("accent", target)} to ${currentBranch}.`,
            theme.fg("error", result.reason ?? "unknown error"),
          ], "error"),
          "warning",
        );
      }
    },
  });
}
