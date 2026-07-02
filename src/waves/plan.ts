import type { WavePlan, WaveSlice } from "./types";

const MAX_WAVE_WIDTH = 8;
const MAX_WAVE_DEPTH = 3;
const WRITER_AGENTS = new Set<WaveSlice["agent"]>(["build", "worker"]);

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}

function pathsOverlap(a: string, b: string): boolean {
  const left = normalizePath(a);
  const right = normalizePath(b);
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function validateWavePlan(plan: WavePlan): WavePlan {
  if (plan.width > MAX_WAVE_WIDTH || plan.maxDepth > MAX_WAVE_DEPTH) {
    throw new Error(`Wave plans must stay bounded: width <= ${MAX_WAVE_WIDTH}, maxDepth <= ${MAX_WAVE_DEPTH}`);
  }

  const writeSlices = plan.slices.filter((slice) => slice.mode === "write");

  for (const slice of writeSlices) {
    if (!WRITER_AGENTS.has(slice.agent)) {
      throw new Error(`Write slice "${slice.id}" must use a worktree-isolated writer agent`);
    }
  }

  for (let i = 0; i < writeSlices.length; i++) {
    const current = writeSlices[i]!;
    for (let j = i + 1; j < writeSlices.length; j++) {
      const next = writeSlices[j]!;
      for (const currentPath of current.paths) {
        for (const nextPath of next.paths) {
          if (pathsOverlap(currentPath, nextPath)) {
            throw new Error(`Write slices "${current.id}" and "${next.id}" overlap on path "${currentPath}"`);
          }
        }
      }
    }
  }

  return plan;
}
