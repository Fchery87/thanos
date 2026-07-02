import { GoalController } from "./controller";
import type { GoalSettings } from "./types";

export interface GoalPersistPayload {
  condition: string;
  status: "active" | "paused";
}

export function serializeGoal(c: GoalController): GoalPersistPayload | undefined {
  const s = c.snapshot();
  if (!s || s.status === "achieved") return undefined;
  return { condition: s.condition, status: s.status };
}

export function restoreController(
  payload: GoalPersistPayload,
  settings: Partial<GoalSettings> | undefined,
  now: () => number,
  tokensNow: number,
): GoalController {
  const c = new GoalController(settings, now);
  c.set(payload.condition, tokensNow); // resets turns/timer/token baseline by design
  if (payload.status === "paused") c.pause();
  return c;
}
