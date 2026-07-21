import type { WavePlan, WaveSlice } from "./types";
import { validateWavePlan } from "./plan";
import { verifyWaveHandoffs, type WaveHandoff, type WaveHandoffVerification } from "./verify";
import type { SubagentResultContract } from "../agents/result";
import { AgentOrchestrator, type BatchTask } from "../agents/orchestrator";

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

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}

function pathsOverlap(a: string, b: string): boolean {
  const left = normalizePath(a);
  const right = normalizePath(b);
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

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

    const writeSlices = slices.filter((slice) => slice.slice.mode === "write");
    for (let i = 0; i < writeSlices.length; i++) {
      const current = writeSlices[i]!;
      for (let j = i + 1; j < writeSlices.length; j++) {
        const next = writeSlices[j]!;
        for (const currentPath of current.slice.paths) {
          for (const nextPath of next.slice.paths) {
            if (pathsOverlap(currentPath, nextPath)) {
              return { valid: false, reason: `overlapping write slices: "${current.slice.id}" and "${next.slice.id}"` };
            }
          }
        }
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

  async run(input: {
    plan: WavePlan;
    execute: (task: BatchTask) => Promise<SubagentResultContract>;
  }): Promise<WaveOutcome> {
    const accepted = this.acceptPlan(input.plan);
    if (!accepted.valid || !this.plan) {
      return {
        status: "failed",
        plan: input.plan,
        waves: [],
        verification: { passed: false, requiresEscalation: true, requiresSynthesisReview: false, issues: [accepted.reason ?? "invalid plan"] },
        synthesisNeeded: false,
        issues: [accepted.reason ?? "invalid plan"],
      };
    }

    const orchestrator = new AgentOrchestrator();
    for (let i = 0; i < input.plan.slices.length; i += input.plan.width) {
      const waveSlices = input.plan.slices.slice(i, i + input.plan.width);
      const tasks = waveSlices.map((slice) => ({ id: slice.id, type: slice.agent === "worker" ? "build" : slice.agent, goal: slice.goal, writeScope: slice.paths }));
      const batch = await orchestrator.runBatch({
        id: `waves:${i}`,
        tasks,
        execute: input.execute,
      });

      const executed: ExecutedSlice[] = waveSlices.map((slice) => {
        const contract = batch.state.results.get(slice.id);
        if (!contract) {
          return { slice, status: "failed", error: "missing contract" };
        }
        const handoff: WaveHandoff = {
          status: contract.status === "success" ? "success" : "blocked",
          slice: slice.id,
          keyFindings: contract.findings.map((finding) => finding.summary),
          evidence: contract.summary.trim().length > 0 ? [contract.summary] : [],
          openQuestions: contract.escalations.map((escalation) => escalation.question),
          suggestedFollowUps: contract.findings.map((finding) => finding.suggestion).filter((value): value is string => typeof value === "string"),
          confidence: contract.status === "success" ? "high" : "low",
        };
        return { slice, status: contract.status === "success" ? "completed" : "failed", handoff, contract };
      });

      const added = this.addWave(executed);
      if (!added.valid) {
        return {
          status: "failed",
          plan: this.plan,
          waves: this.waves,
          verification: { passed: false, requiresEscalation: true, requiresSynthesisReview: false, issues: [added.reason ?? "invalid wave"] },
          synthesisNeeded: false,
          issues: [added.reason ?? "invalid wave"],
        };
      }
      if (this.shouldStopAfter(this.waves.length - 1)) {
        break;
      }
    }
    return this.complete();
  }
}
