import type { WavePlan, WaveSlice, WaveSliceMode } from "./types";
import { validateWavePlan } from "./plan";
import { verifyWaveHandoffs, type WaveHandoff, type WaveHandoffVerification } from "./verify";
import type { SubagentResultContract } from "../agents/result";

export interface WaveOutcome {
  status: "completed" | "partial" | "failed" | "cancelled";
  plan: WavePlan;
  waves: WaveExecutionWave[];
  verification: WaveHandoffVerification;
  synthesisNeeded: boolean;
  issues: string[];
}

export interface WaveExecutionWave {
  index: number;
  slices: ExecutedSlice[];
}

export interface ExecutedSlice {
  slice: WaveSlice;
  status: "completed" | "failed" | "skipped" | "cancelled";
  handoff?: WaveHandoff;
  contract?: SubagentResultContract;
  error?: string;
}

const MAX_PLAN_SIZE = 16;
const MAX_WAVES = 3;

export class WavesRuntime {
  private plan: WavePlan | undefined;
  private waves: WaveExecutionWave[] = [];
  private cancelled = false;

  acceptPlan(plan: WavePlan): { valid: boolean; reason?: string } {
    try {
      validateWavePlan(plan);
    } catch (err) {
      return { valid: false, reason: err instanceof Error ? err.message : String(err) };
    }

    if (plan.slices.length > MAX_PLAN_SIZE) {
      return { valid: false, reason: `plan has ${plan.slices.length} slices, max is ${MAX_PLAN_SIZE}` };
    }

    this.plan = plan;
    return { valid: true };
  }

  getPlan(): WavePlan | undefined {
    return this.plan;
  }

  addWave(slices: ExecutedSlice[]): { valid: boolean; reason?: string } {
    if (!this.plan) return { valid: false, reason: "no plan accepted" };
    if (this.cancelled) return { valid: false, reason: "cancelled" };
    if (this.waves.length >= MAX_WAVES) {
      return { valid: false, reason: `max ${MAX_WAVES} waves exceeded` };
    }

    // Validate slices reference actual plan slices
    const planSliceIds = new Set(this.plan.slices.map((s) => s.id));
    for (const s of slices) {
      if (!planSliceIds.has(s.slice.id)) {
        return { valid: false, reason: `slice "${s.slice.id}" not in plan` };
      }
    }

    this.waves.push({ index: this.waves.length, slices });
    return { valid: true };
  }

  cancel(): void {
    this.cancelled = true;
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  shouldStopAfter(waveIndex: number): boolean {
    if (!this.plan) return true;

    const currentWave = this.waves[waveIndex];
    if (!currentWave) return false;

    // A failed required (non-read) handoff stops dependent work
    for (const s of currentWave.slices) {
      if (s.slice.mode === "write" && s.status === "failed") {
        return true;
      }
      if (s.handoff && s.handoff.status === "blocked") {
        return true;
      }
    }

    return false;
  }

  complete(): WaveOutcome {
    if (!this.plan) {
      return {
        status: "failed",
        plan: { width: 0, maxDepth: 0, slices: [] },
        waves: [],
        verification: { passed: false, requiresEscalation: true, requiresSynthesisReview: false, issues: ["no plan"] },
        synthesisNeeded: false,
        issues: ["no plan was accepted"],
      };
    }

    const allHandoffs: WaveHandoff[] = [];
    const issues: string[] = [];

    for (const wave of this.waves) {
      for (const s of wave.slices) {
        if (s.handoff) {
          allHandoffs.push(s.handoff);
        }
        if (s.error) {
          issues.push(`${s.slice.id}: ${s.error}`);
        }
        if (s.status === "failed" && s.slice.mode === "write") {
          issues.push(`${s.slice.id}: write slice failed — dependent work halted`);
        }
      }
    }

    const verification = verifyWaveHandoffs(allHandoffs);
    const allIssues = [...issues, ...verification.issues];

    const hasFailures = this.waves.some((w) =>
      w.slices.some((s) => s.status === "failed"),
    );

    const status = this.cancelled ? "cancelled"
      : hasFailures ? "partial"
      : verification.passed ? "completed"
      : "partial";

    return {
      status,
      plan: this.plan,
      waves: this.waves,
      verification,
      synthesisNeeded: verification.requiresSynthesisReview || hasFailures,
      issues: allIssues,
    };
  }
}
