import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

/**
 * pi-subagents 0.41.0 ships raw TypeScript source (no compiled dist), and its
 * package.json `exports` map only lists specific subpaths — `./package.json`
 * is not one of them, so resolving it directly 404s under Node's exports
 * enforcement. Resolving the `.` entry (`pi-subagents` -> index.ts) *is*
 * exported, and index.ts always lives at the package root, so we can walk
 * from there to src/agents/agents.ts without hardcoding an absolute path.
 */
const packageEntry = createRequire(import.meta.url).resolve("pi-subagents");
const AGENTS_TS = join(dirname(packageEntry), "src/agents/agents.ts");

describe("pi-subagents frontmatter contract", () => {
  const source = readFileSync(AGENTS_TS, "utf-8");
  const read = new Set([...source.matchAll(/frontmatter\.([a-zA-Z]+)/g)].map((m) => m[1]));

  // Regression guard, not a red test: this pins the *current* 0.41.0 key set
  // so a future upstream rename fails loudly here instead of silently
  // reintroducing the "budget keys are read by nobody" bug. It is expected
  // to pass immediately.
  it("reads the budget keys Thanos relies on", () => {
    expect(read.has("timeoutMs"), "timeoutMs is the live wall-clock budget key").toBe(true);
    expect(read.has("turnBudget"), "turnBudget is the live turn budget key").toBe(true);
    expect(read.has("maxSubagentDepth")).toBe(true);
  });

  it("still does not read the retired keys", () => {
    expect(read.has("maxExecutionTimeMs")).toBe(false);
    expect(read.has("maxTurns")).toBe(false);
    expect(read.has("maxTokens")).toBe(false);
  });
});
