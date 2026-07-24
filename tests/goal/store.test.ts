import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { saveGoalState, loadGoalState, clearGoalState } from "../../src/goal/store";

const goalStatePath = (repo: string) => join(repo, ".harness", "goal-state.json");

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "goal-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

it("roundtrips an active goal keyed by repo path", async () => {
  await saveGoalState(dir, { condition: "all tests pass", status: "active", repo: dir });
  const loaded = await loadGoalState(dir, dir);
  expect(loaded).toEqual({ condition: "all tests pass", status: "active", repo: dir });
});

it("does not restore when the repo path differs", async () => {
  await saveGoalState(dir, { condition: "x", status: "active", repo: "/other/repo" });
  expect(await loadGoalState(dir, dir)).toBeUndefined();
});

it("clearGoalState removes the file (achieved goals never restore)", async () => {
  await saveGoalState(dir, { condition: "x", status: "paused", repo: dir });
  await clearGoalState(dir);
  expect(await loadGoalState(dir, dir)).toBeUndefined();
});

it("returns undefined (never throws) on a missing file", async () => {
  expect(await loadGoalState(dir, dir)).toBeUndefined();
});

it("returns undefined (never throws) on a corrupt file", async () => {
  const p = goalStatePath(dir);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, "{ not valid json");
  expect(await loadGoalState(dir, dir)).toBeUndefined();
});

it("rejects a condition longer than MAX_CONDITION", async () => {
  await saveGoalState(dir, { condition: "x".repeat(4001), status: "active", repo: dir });
  expect(await loadGoalState(dir, dir)).toBeUndefined();
});
