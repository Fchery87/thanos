import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off:     "off      — no reasoning",
  minimal: "minimal  — ~1k tokens",
  low:     "low      — ~2k tokens",
  medium:  "medium   — ~8k tokens",
  high:    "high     — ~16k tokens",
  xhigh:   "xhigh    — ~32k tokens",
};

export function getSupportedLevels(model: { reasoning: boolean; thinkingLevelMap?: Partial<Record<string, string | null>> }): ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  return ALL_THINKING_LEVELS.filter((level) => model.thinkingLevelMap?.[level] !== null);
}

export function setThinkingStatus(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const level = pi.getThinkingLevel() as ThinkingLevel | undefined;
  ctx.ui.setStatus("harness-thinking", level && level !== "off" ? ctx.ui.theme.fg("accent", `thinking:${level}`) : undefined);
}

/**
 * Shared "pick a thinking level from the current model's supported set"
 * flow — used by both the /thinking command (no explicit level typed) and
 * the ctrl+shift+k shortcut, which were previously two copies of the same
 * code inline in register-harness.ts.
 */
export async function promptAndSetThinkingLevel(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const model = ctx.model;
  if (!model) {
    ctx.ui.notify("No model active", "warning");
    return;
  }
  if (!ctx.hasUI) {
    ctx.ui.notify("Thinking selector requires an interactive UI", "warning");
    return;
  }
  const levels = getSupportedLevels(model);
  const options = levels.map((l) => THINKING_LABELS[l]);
  const selected = await ctx.ui.select("Select thinking level", options);
  if (!selected) return;
  const level = levels[options.indexOf(selected)];
  if (!level) return;
  pi.setThinkingLevel(level);
  setThinkingStatus(pi, ctx);
}
