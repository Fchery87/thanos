import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvaluatorOverride } from "./evaluator-model";
import type { GoalSettings } from "./types";

function settingsPath(): string {
  const home = process.env.HOME;
  return home
    ? join(home, ".pi", "agent", "settings.json")
    : join(process.cwd(), "agent", "settings.json");
}

/**
 * Best-effort read of the `goal` block from ~/.pi/agent/settings.json.
 * Returns undefined on any error so GoalController falls back to defaults.
 */
export function loadGoalSettings(): Partial<GoalSettings> | undefined {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf-8")) as { goal?: Partial<GoalSettings> };
    return raw.goal;
  } catch {
    return undefined;
  }
}

/**
 * Pull the ACTIVE routing entry for a role out of a parsed settings object.
 * Reads only `subagents.agentOverrides` — the key pi-subagents applies — so
 * the goal evaluator follows the same on/off toggle as every other subagent
 * (savedAgentOverrides is the inactive stash and is deliberately ignored).
 */
export function evaluatorOverrideFrom(settings: unknown, role: string): EvaluatorOverride | undefined {
  if (typeof settings !== "object" || settings === null) return undefined;
  const subagents = (settings as { subagents?: unknown }).subagents;
  if (typeof subagents !== "object" || subagents === null) return undefined;
  const overrides = (subagents as { agentOverrides?: unknown }).agentOverrides;
  if (typeof overrides !== "object" || overrides === null) return undefined;
  const entry = (overrides as Record<string, unknown>)[role];
  if (typeof entry !== "object" || entry === null) return undefined;
  const { model, fallbackModels } = entry as { model?: unknown; fallbackModels?: unknown };
  if (typeof model !== "string" || model.trim() === "") return undefined;
  const fallbacks = Array.isArray(fallbackModels)
    ? fallbackModels.filter((f): f is string => typeof f === "string")
    : undefined;
  return { model, ...(fallbacks && fallbacks.length > 0 ? { fallbackModels: fallbacks } : {}) };
}

/**
 * Best-effort read of the live routing entry for the goal evaluator role.
 * Re-reads settings.json on each call so /subagents-models enable|disable
 * takes effect mid-session without a restart.
 */
export function loadEvaluatorOverride(role: string): EvaluatorOverride | undefined {
  try {
    return evaluatorOverrideFrom(JSON.parse(readFileSync(settingsPath(), "utf-8")), role);
  } catch {
    return undefined;
  }
}
