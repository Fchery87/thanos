import type { AgentType } from "./registry";
import type { SpecialistId } from "./catalog";
import { mayDelegateTo, type SpecialistProfile } from "./catalog";
import type { SubagentResultContract } from "./result";

export interface BatchTask {
  id: string;
  type: SpecialistId;
  goal: string;
  context?: string;
  writeScope?: string[];
}

export interface BatchState {
  id: string;
  tasks: BatchTask[];
  active: string[];
  completed: string[];
  failed: string[];
  results: Map<string, SubagentResultContract>;
}

const MAX_WIDTH = 8;
const MAX_DEPTH = 1;

export class AgentOrchestrator {
  private activeBatches = new Map<string, BatchState>();
  private activeRunIds = new Set<string>();

  validateBatch(tasks: BatchTask[]): { valid: boolean; reason?: string } {
    if (tasks.length > MAX_WIDTH) {
      return { valid: false, reason: `batch width ${tasks.length} exceeds max ${MAX_WIDTH}` };
    }

    const seenIds = new Set<string>();
    for (const task of tasks) {
      if (seenIds.has(task.id)) {
        return { valid: false, reason: `duplicate task id: ${task.id}` };
      }
      seenIds.add(task.id);
    }

    // Validate write scopes don't overlap
    const writeTasks = tasks.filter((t) => t.writeScope && t.writeScope.length > 0);
    for (let i = 0; i < writeTasks.length; i++) {
      const a = writeTasks[i]!;
      for (let j = i + 1; j < writeTasks.length; j++) {
        const b = writeTasks[j]!;
        for (const pathA of a.writeScope!) {
          for (const pathB of b.writeScope!) {
            const na = pathA.replace(/\/+$/, "");
            const nb = pathB.replace(/\/+$/, "");
            if (na === nb || na.startsWith(nb + "/") || nb.startsWith(na + "/")) {
              return { valid: false, reason: `overlapping write scopes: "${a.id}" and "${b.id}" on "${pathA}"` };
            }
          }
        }
      }
    }

    return { valid: true };
  }

  canDelegate(parent: string, child: string): boolean {
    return mayDelegateTo(parent, child);
  }

  createBatch(id: string, tasks: BatchTask[]): BatchState {
    const validation = this.validateBatch(tasks);
    if (!validation.valid) {
      throw new Error(validation.reason ?? "invalid batch");
    }

    const state: BatchState = {
      id,
      tasks,
      active: [],
      completed: [],
      failed: [],
      results: new Map(),
    };

    this.activeBatches.set(id, state);
    return state;
  }

  startTask(batchId: string, taskId: string): void {
    const batch = this.activeBatches.get(batchId);
    if (!batch) throw new Error(`batch ${batchId} not found`);

    if (batch.active.includes(taskId)) return;
    if (batch.completed.includes(taskId) || batch.failed.includes(taskId)) {
      throw new Error(`task ${taskId} already completed`);
    }

    batch.active.push(taskId);
    this.activeRunIds.add(taskId);
  }

  completeTask(batchId: string, taskId: string, result: SubagentResultContract): void {
    const batch = this.activeBatches.get(batchId);
    if (!batch) throw new Error(`batch ${batchId} not found`);

    batch.active = batch.active.filter((id) => id !== taskId);
    this.activeRunIds.delete(taskId);

    if (result.status === "error" || result.status === "timeout") {
      batch.failed.push(taskId);
    } else {
      batch.completed.push(taskId);
    }

    batch.results.set(taskId, result);
  }

  isBatchComplete(batchId: string): boolean {
    const batch = this.activeBatches.get(batchId);
    if (!batch) return true;
    return batch.active.length === 0;
  }

  getBatchState(batchId: string): BatchState | undefined {
    return this.activeBatches.get(batchId);
  }

  cancelBatch(batchId: string): void {
    const batch = this.activeBatches.get(batchId);
    if (!batch) return;

    for (const id of batch.active) {
      this.activeRunIds.delete(id);
    }
    this.activeBatches.delete(batchId);
  }

  cancelAll(): void {
    this.activeRunIds.clear();
    this.activeBatches.clear();
  }

  get activeRunCount(): number {
    return this.activeRunIds.size;
  }
}
