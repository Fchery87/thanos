import { buildFirstDirective } from "./prompts";
import { resolveGoalSettings, type GoalSettings, type GoalSnapshot } from "./types";

const MAX_CONDITION = 4000;

interface Internal {
  condition: string;
  status: "active" | "paused" | "achieved";
  startedAt: number;
  turnsEvaluated: number;
  tokensUsed: number;
  lastTokens: number;
  lastReason?: string;
  achieved?: { at: number; reason: string; turns: number };
}

export type SetResult =
  | { ok: true; replaced: boolean; firstDirective: string }
  | { ok: false; error: string };

export class GoalController {
  private readonly settings: GoalSettings;
  private readonly now: () => number;
  private g: Internal | undefined;

  constructor(settings?: Partial<GoalSettings>, now: () => number = () => Date.now()) {
    this.settings = resolveGoalSettings(settings);
    this.now = now;
  }

  snapshot(): GoalSnapshot | undefined {
    if (!this.g) return undefined;
    const { lastTokens: _ignored, ...pub } = this.g;
    return { ...pub };
  }

  /** True while a goal is ACTIVE — used to suppress the verification gate. */
  isActive(): boolean {
    return this.g?.status === "active";
  }

  set(condition: string, tokensNow: number): SetResult {
    const trimmed = condition.trim();
    if (trimmed === "") return { ok: false, error: "Goal condition is empty." };
    if (trimmed.length > MAX_CONDITION) return { ok: false, error: `Condition exceeds ${MAX_CONDITION} characters.` };
    const replaced = this.g !== undefined && this.g.status !== "achieved";
    this.g = {
      condition: trimmed, status: "active", startedAt: this.now(),
      turnsEvaluated: 0, tokensUsed: 0, lastTokens: tokensNow,
    };
    return { ok: true, replaced, firstDirective: buildFirstDirective(trimmed) };
  }

  clear(): void { this.g = undefined; }

  pause(): boolean {
    if (this.g?.status !== "active") return false;
    this.g.status = "paused";
    return true;
  }

  resume(): boolean {
    if (this.g?.status !== "paused") return false;
    this.g.status = "active";
    return true;
  }
}
