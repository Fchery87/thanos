import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { SubagentResultContract } from "./result";

export type RunState = "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout";

interface RunStateFile {
  id: string;
  state: RunState;
  agentType: string;
  goal: string;
  contextMode: string;
  startedAt: string;
  endedAt?: string;
  pid?: number;
}

const VALID_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  pending: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled", "timeout"],
  completed: [],
  failed: [],
  cancelled: [],
  timeout: [],
};

const MAX_RETENTION_COUNT = 100;
const MAX_RETENTION_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_RETENTION_BYTES = 200 * 1024 * 1024; // 200 MB
const GC_TIME_LIMIT_MS = 5000;
const GC_FILE_LIMIT = 1000;

export class RunStore {
  constructor(private baseDir: string) {}

  get runDir(): string {
    return this.baseDir;
  }

  private runPath(runId: string): string {
    return join(this.baseDir, runId);
  }

  async create(runId: string, meta: Omit<RunStateFile, "state" | "startedAt">): Promise<void> {
    const path = this.runPath(runId);
    await mkdir(path, { recursive: true });
    const stateFile: RunStateFile = {
      ...meta,
      state: "pending",
      startedAt: new Date().toISOString(),
    };
    await this.atomicWrite(join(path, "state.json"), JSON.stringify(stateFile));
  }

  async transition(runId: string, to: RunState): Promise<void> {
    const path = this.runPath(runId);
    const stateFile = join(path, "state.json");
    let current: RunStateFile;
    try {
      current = JSON.parse(await readFile(stateFile, "utf-8")) as RunStateFile;
    } catch {
      throw new Error(`Run ${runId} not found`);
    }

    const allowed = VALID_TRANSITIONS[current.state];
    if (!allowed || !allowed.includes(to)) {
      throw new Error(`Invalid state transition: ${current.state} -> ${to} (run ${runId})`);
    }

    current.state = to;
    if (to === "completed" || to === "failed" || to === "cancelled" || to === "timeout") {
      current.endedAt = new Date().toISOString();
    }
    await this.atomicWrite(stateFile, JSON.stringify(current));
  }

  async writeResult(runId: string, result: SubagentResultContract): Promise<void> {
    const path = this.runPath(runId);
    await this.atomicWrite(join(path, "result.json"), JSON.stringify(result));
  }

  async readResult(runId: string): Promise<SubagentResultContract | undefined> {
    try {
      const raw = await readFile(join(this.runPath(runId), "result.json"), "utf-8");
      return JSON.parse(raw) as SubagentResultContract;
    } catch {
      return undefined;
    }
  }

  async readState(runId: string): Promise<RunStateFile | undefined> {
    try {
      const raw = await readFile(join(this.runPath(runId), "state.json"), "utf-8");
      return JSON.parse(raw) as RunStateFile;
    } catch {
      return undefined;
    }
  }

  async writeArtifact(runId: string, name: string, content: string): Promise<string> {
    const artifactsDir = join(this.runPath(runId), "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    const safeName = basename(name).replace(/[^A-Za-z0-9._-]/g, "_") || "artifact";
    const filePath = join(artifactsDir, safeName);
    await writeFile(filePath, content, "utf-8");
    return filePath;
  }

  async writePatch(runId: string, content: string): Promise<void> {
    const path = this.runPath(runId);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "changes.patch"), content, "utf-8");
  }

  async removeRun(runId: string): Promise<void> {
    await rm(this.runPath(runId), { recursive: true, force: true });
  }

  async gc(options?: { maxCount?: number; maxAgeMs?: number; maxBytes?: number }): Promise<number> {
    const maxCount = options?.maxCount ?? MAX_RETENTION_COUNT;
    const maxAgeMs = options?.maxAgeMs ?? MAX_RETENTION_AGE_MS;
    const maxBytes = options?.maxBytes ?? MAX_RETENTION_BYTES;
    const deadline = Date.now() + GC_TIME_LIMIT_MS;

    let entries: string[];
    try {
      entries = await readdir(this.baseDir);
    } catch {
      return 0;
    }

    const limit = Math.min(entries.length, GC_FILE_LIMIT);
    entries = entries.slice(0, limit);

    const infos: Array<{ id: string; mtime: number; size: number; state?: RunState }> = [];

    for (const entry of entries) {
      if (Date.now() > deadline) break;

      const dirPath = join(this.baseDir, entry);
      let dirStat;
      try {
        dirStat = await stat(dirPath);
      } catch {
        continue;
      }
      if (!dirStat.isDirectory()) continue;

      let state: RunState | undefined;
      try {
        const stateRaw = await readFile(join(dirPath, "state.json"), "utf-8");
        const parsed = JSON.parse(stateRaw) as RunStateFile;
        state = parsed.state;
      } catch {
        // no state file — treat as removable
      }

      infos.push({ id: entry, mtime: dirStat.mtimeMs, size: dirStat.size, state });
    }

    // Sort by mtime ascending (oldest first)
    infos.sort((a, b) => a.mtime - b.mtime);

    // Remove by age
    let removed = 0;
    for (const info of infos) {
      if (Date.now() > deadline) break;
      const age = Date.now() - info.mtime;
      if (age > maxAgeMs) {
        await this.removeRun(info.id);
        removed++;
      }
    }

    // Remove terminal states by count
    const active = infos.filter((i) => i.state === "pending" || i.state === "running");
    const terminal = infos.filter((i) => !active.includes(i)).slice(0, Math.max(0, maxCount - active.length));
    for (const info of terminal) {
      if (Date.now() > deadline) break;
      if (infos.length - removed <= maxCount) break;
      await this.removeRun(info.id);
      removed++;
    }

    return removed;
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tmpPath = filePath + ".tmp." + Math.random().toString(36).slice(2, 8);
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, filePath);
  }
}
