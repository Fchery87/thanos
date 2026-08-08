// The harness's honest numbers. Two measurements and one count, all real, all
// reproducible from a clean checkout:
//
//   1. cold import   — how long pi waits before the extension is registered
//   2. turn overhead — what Thanos adds to every parent turn's prompt
//   3. source size   — a count, reported as a count
//
// This exists because the three instruments it replaces did not measure what
// they claimed. A vitest-hosted "cold load" timed the test runner's TypeScript
// transform (31,578ms reported against ~1,530ms actual) and asserted only
// `> 0`, so it could never fail; two "benchmarks" wrote line and import counts
// into a field named `durationMs`; and an eval suite emitted `ok: true` with
// synthetic latencies without ever calling a model.
//
// Rules for anything added here:
//   - measure elapsed time or bytes, and label counts as counts
//   - if it cannot fail, it is not a gate
//   - a number produced inside vitest measures vitest
//
// Usage: bun run measure [--json]

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assembleSystemPrompt } from "../src/runtime/prompt-assembly.ts";
import { SKILLS_DIRECTIVE, TRUSTED_INSTRUCTIONS } from "../src/runtime/before-agent-start.ts";
import { formatRoster, loadRoster } from "../src/agents/roster.ts";
import { buildGoalSystemPrompt } from "../src/goal/prompts.ts";
import { PermissionManager, formatPermissionMode } from "../src/permissions/manager.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const asJson = process.argv.includes("--json");

// ── 1. Cold import ─────────────────────────────────────────────────────────
// A fresh process per run, because that is the only shape the real thing has:
// pi starts, imports the extension once, and the user waits. Timing it
// in-process, after the module graph is already warm, measures nothing.
const COLD_RUNS = 5;

function coldImportMs() {
  const run = spawnSync(
    process.execPath,
    ["-e", 'const t=performance.now(); await import("./src/index.ts"); console.log(performance.now()-t);'],
    { cwd: repoRoot, encoding: "utf-8" },
  );
  if (run.status !== 0) throw new Error(`cold import failed: ${run.stderr || run.stdout}`);
  return Number.parseFloat(run.stdout.trim());
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const coldRuns = Array.from({ length: COLD_RUNS }, coldImportMs);

// ── 2. Per-turn prompt overhead ────────────────────────────────────────────
// What the harness prepends to a parent turn, with Pi's own base prompt
// excluded — that part is not ours and would drown the signal. The split
// matters more than the total: static blocks ride the cached prompt prefix and
// are paid once per session, dynamic blocks are re-sent every single turn.
const roster = formatRoster(await loadRoster());
const assembled = assembleSystemPrompt({
  baseSystemPrompt: "",
  isSubagent: false,
  trustedInstructions: TRUSTED_INSTRUCTIONS,
  skillsDirective: SKILLS_DIRECTIVE,
  roster,
  // Default permission mode (yolo off) — the common case, and what a fresh
  // PermissionManager() reports without needing a toggle first.
  permissionMode: formatPermissionMode(new PermissionManager()),
  // An active goal is the worst realistic case for the dynamic tail. Memories
  // are per-project, so they are excluded rather than guessed at.
  goalDirective: buildGoalSystemPrompt("All tests pass"),
});

// ~4 chars/token, and labelled approximate wherever it is printed. A real
// tokenizer here would be precision the rest of this number does not have.
const tokens = (text) => Math.ceil((text ?? "").length / 4);

// ── 3. Source size ─────────────────────────────────────────────────────────
// Recorded so the Phase 4 deletions have a before/after. Not a performance
// metric, and not reported as one.
function countSource(dir) {
  let files = 0;
  let lines = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = countSource(path);
      files += nested.files;
      lines += nested.lines;
    } else if (entry.name.endsWith(".ts")) {
      files += 1;
      lines += readFileSync(path, "utf-8").split("\n").length;
    }
  }
  return { files, lines };
}

const source = countSource(join(repoRoot, "src"));

const report = {
  measuredAt: new Date().toISOString(),
  coldImport: {
    medianMs: Math.round(median(coldRuns)),
    minMs: Math.round(Math.min(...coldRuns)),
    maxMs: Math.round(Math.max(...coldRuns)),
    runs: COLD_RUNS,
  },
  turnOverhead: {
    staticChars: (assembled.systemPrompt ?? "").length,
    staticTokensApprox: tokens(assembled.systemPrompt),
    dynamicChars: (assembled.dynamicMessage ?? "").length,
    dynamicTokensApprox: tokens(assembled.dynamicMessage),
    rosterChars: roster.length,
  },
  source,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const { coldImport, turnOverhead } = report;
  console.log(`cold import     ${coldImport.medianMs}ms median (${coldImport.minMs}-${coldImport.maxMs}ms over ${coldImport.runs} fresh processes)`);
  console.log(`turn overhead   ~${turnOverhead.staticTokensApprox} tok cached prefix + ~${turnOverhead.dynamicTokensApprox} tok per-turn tail`);
  console.log(`                (of the prefix, ~${Math.ceil(turnOverhead.rosterChars / 4)} tok is the agent roster)`);
  console.log(`source          ${source.files} files, ${source.lines} lines`);
}
