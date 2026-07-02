import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GoalSettings } from "./types";

/**
 * Best-effort read of the `goal` block from ~/.pi/agent/settings.json.
 * Returns undefined on any error so GoalController falls back to defaults.
 */
export function loadGoalSettings(): Partial<GoalSettings> | undefined {
  try {
    const home = process.env.HOME;
    const path = home
      ? join(home, ".pi", "agent", "settings.json")
      : join(process.cwd(), "agent", "settings.json");
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { goal?: Partial<GoalSettings> };
    return raw.goal;
  } catch {
    return undefined;
  }
}
