import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getSupportedLevels, setThinkingStatus, THINKING_LABELS } from "./thinking-levels";

/**
 * Model-lifecycle hooks: prompt for a thinking level when switching onto a
 * reasoning model, and keep the status bar in sync when the level changes
 * via Shift+Tab (pi core's own cycle shortcut, not one of ours).
 */
export function registerModelEvents(pi: ExtensionAPI): void {
  // ── Auto-prompt thinking level when switching to a reasoning model ──
  pi.on("model_select", async (event, ctx) => {
    if (!event.model.reasoning) {
      ctx.ui.setStatus("harness-thinking", undefined);
      return;
    }
    if (!ctx.hasUI) return;
    const levels = getSupportedLevels(event.model);
    const options = levels.map((l) => THINKING_LABELS[l]);
    const selected = await ctx.ui.select("Select thinking level", options);
    if (!selected) return;
    const level = levels[options.indexOf(selected)];
    if (!level) return;
    pi.setThinkingLevel(level);
    setThinkingStatus(pi, ctx);
  });

  // ── Keep status bar in sync with Shift+Tab cycles ──────────────────
  pi.on("thinking_level_select", (_event, ctx) => {
    setThinkingStatus(pi, ctx);
  });
}
