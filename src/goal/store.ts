import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MAX_CONDITION } from "./controller";
import type { GoalPersistPayload } from "./persist";

export interface StoredGoal extends GoalPersistPayload {
  repo: string;
}

function path(repo: string): string {
  return join(repo, ".harness", "goal-state.json");
}

export async function saveGoalState(repo: string, state: StoredGoal): Promise<void> {
  const p = path(repo);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, `${JSON.stringify(state, null, 2)}\n`);
}

export async function loadGoalState(repo: string, expectedRepo: string): Promise<StoredGoal | undefined> {
  try {
    const raw = JSON.parse(await readFile(path(repo), "utf-8")) as StoredGoal;
    if (!raw || raw.repo !== expectedRepo || (raw.status !== "active" && raw.status !== "paused")) return undefined;
    if (typeof raw.condition !== "string" || raw.condition.trim() === "") return undefined;
    if (raw.condition.length > MAX_CONDITION) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

export async function clearGoalState(repo: string): Promise<void> {
  try {
    await rm(path(repo), { force: true });
  } catch {
    /* best effort */
  }
}
