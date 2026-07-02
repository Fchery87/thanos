# Harness Fixes + `/goal` Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Phase 0 MUST run in the main checkout at `~/.pi` (the uncommitted work lives in that working tree — a fresh worktree would not contain it). Phases 1–2 may run in a dedicated worktree after Phase 0 lands. Use superpowers:test-driven-development for every code task.

**Goal:** Land the uncommitted Fable-class roadmap work safely, then add a session-scoped `/goal` command (self-checking autonomous loop) that is fully coordinated with the existing completion verification gate, then close the `git <flags> push` delivery-mode bypass.

**Architecture:** Phase 0 is pure git hygiene — milestone-ordered commits of the 81 dirty files, each commit leaving a tree that typechecks. Phase 1 implements `/goal` as a pure, pi-free `GoalController` plus pure helpers (verdict parsing, directive/context building, last-turn extraction, command parsing, persistence) mirroring the existing `SpecEngine` pattern, with a thin wiring layer injecting side effects (`sendUserMessage`, `completeSimple`, `notify`). The evaluator is a **side-channel `completeSimple` call** — no agent turn, no re-entrancy. Critically, `/goal` and the verification gate (ADR 0006) both hook `agent_end` and both send `followUp` messages, so this plan makes them mutually exclusive drivers: goal directives carry their own sentinel (no spec regeneration per goal turn), and gate re-injection is suppressed while a goal is active. Phase 2 adds an argv-level `git push` classifier so interposed-flag forms (`git -C dir push`) no longer bypass local-only mode.

**Tech Stack:** TypeScript (ESM), vitest, Bun, `@earendil-works/pi-coding-agent` 0.80.2 (ExtensionAPI), `@earendil-works/pi-ai` (`completeSimple`).

**Supersedes:** `docs/plans/2026-07-01-goal-command-design.md` and `docs/plans/2026-07-01-goal-command-plan.md`. This plan merges both and amends them with four review fixes (gate coordination, mandatory tool-result extraction, paused-state persistence, cumulative token accounting) plus one API correction (`willRetry` is not on the typed extension event). Task 18 marks the old docs superseded.

---

## Key grounding facts (verified against the live tree, 2026-07-02)

- `bun run ci` is green at the current dirty tree: 76 test files, 474 tests, typecheck + lint clean. Phase 0 commits a known-good state.
- The verification gate is live: `src/index.ts:1328` guards `before_agent_start` with `GATE_CONTINUE_SENTINEL`; `src/index.ts:1466-1487` re-injects via `pi.sendUserMessage(prompt, { deliverAs: "followUp" })` and logs a `gate_failure` ledger event.
- `SpecEngine.classify` (`src/spec/engine.ts:33-40`): any prompt ≥ 20 chars not starting with `what|how|why|explain|show|list|describe|tell` is **ambient** → generates a fresh spec and wipes evidence. A `/goal` directive matches ambient — this is why goal directives need their own sentinel.
- `shouldReinject` lives in `src/spec/gate.ts` with inputs `{ results, attempts, isSubagent, enabled }`.
- `completeSimple(model, context, options?): Promise<AssistantMessage>` exists at `node_modules/@earendil-works/pi-ai/dist/compat.d.ts:64`. `Context = { systemPrompt?, messages, tools? }`.
- Message shapes (`pi-ai/dist/types.d.ts:265-293`): `AssistantMessage.content: (TextContent | ThinkingContent | ToolCall)[]`; `ToolResultMessage = { role: "toolResult", toolName, content: (TextContent | ImageContent)[], isError, ... }`; `UserMessage.content: string | (TextContent | ImageContent)[]`.
- **API correction vs the old design doc:** the extension `AgentEndEvent` (`pi-coding-agent/dist/core/extensions/types.d.ts:515`) declares only `messages: AgentMessage[]`. `willRetry` exists on the *session-level* `agent_end` event (`dist/core/agent-session.d.ts:40-46`). At runtime the field may or may not be passed through to extensions — read it defensively (Task 10) and verify live (Task 16).
- `evaluator` is already a model-routing role (`src/agents/model-routing.ts:54`). Settings are read from `agentFilePath("settings.json")` (`src/agents/model-routing.ts:309`).
- Harness ledger: `HarnessEventType` union + `appendHarnessEvent` in `src/observability/harness-ledger.ts:6-30`; `src/index.ts` already calls `appendHarnessEvent` in the gate path — reuse that import style.
- Push-deny gap: `src/governance/delivery-overlay.ts:30-52` documents that `git <flags> push` bypasses the anchored globs. `evaluatePolicy` (`src/policy/evaluator.ts`) already does clause-split denies using `splitShellClauses` from `src/audit/target.ts:52`. `resolveDeliveryState` returns `{ mode, autonomy, ... }` (`src/governance/delivery.ts:74`) and both `deliveryStatePromise` and the `tool_call` handler are in scope in `src/index.ts:1376-1429`.
- Conventions: tests in `tests/<area>/*.test.ts`, `import { describe, expect, it } from "vitest"`, source imported as `../../src/...`. Single file: `bunx vitest run tests/goal/<file>.test.ts`. Full gate: `bun run ci`.

## Resolved design decisions for `/goal` (carried from the 2026-07-01 grilling, amended)

- **Autonomy:** guarded auto-loop; `maxTurns` default 25; ceilings PAUSE (resumable), never clear.
- **Fire event:** `agent_end`; skip when `willRetry === true` (read defensively) or `isSubagent`.
- **Continue:** `pi.sendUserMessage(directive, { deliverAs: "followUp" })`.
- **Evaluator model:** `evaluator` model-routing role override if set, else current session model at `reasoning: "low"`. Side-channel `completeSimple`; tool-less; one-shot.
- **Evaluator input:** condition + last work turn ONLY (last assistant text + that turn's tool results + previous evaluator reason). **AMENDED (Fix 2):** tool-result extraction is a mandatory, unit-tested module — an evaluator that sees only the assistant's claim text re-creates self-certification.
- **Verdict protocol:** `VERDICT: MET|NOT_MET` / `REASON: <one line>`; unparseable → NOT_MET (fail-safe).
- **Commands:** `/goal <cond>` · `/goal` (status) · `/goal clear` (aliases `stop off reset none cancel`) · `/goal pause` · `/goal resume`. Condition ≤ 4000 chars, main-session only, trust-gated, one active goal (replace notifies).
- **AMENDED (Fix 1 — gate coordination):** every goal-injected message is prefixed with `GOAL_DIRECTIVE_SENTINEL`; `before_agent_start` skips `spec.startTurn` for it (same treatment as `GATE_CONTINUE_SENTINEL`); `shouldReinject` gains `goalActive: boolean` and returns false while a goal is active. **While a goal is active, the goal evaluator is the only continuation driver.**
- **AMENDED (Fix 3 — persistence):** the persisted payload carries `status` (`active` | `paused`); a paused goal restores as paused. Achieved/cleared goals are not persisted.
- **AMENDED (Fix 4 — token accounting):** `ctx.getContextUsage().tokens` is context *size*, not spend — it shrinks on compaction, so a naive `now - atStart` delta can go negative and never trip the ceiling. The controller instead accumulates `tokensUsed += max(0, tokensNow - lastTokens)` per evaluated turn and compares `maxTokens` against that. Documented as a context-growth guard, not a spend cap; `maxTurns` remains the real budget.
- **Failures:** work-turn error → pause + surface. Evaluator throws → retry once, then pause. Never silently stop or continue.
- **Observability:** `goal_set` / `goal_achieved` / `goal_paused` events go to the M7 harness ledger, per the change-manifest rule in `docs/harness-evolution.md`.
- **Out of scope (YAGNI):** multiple concurrent goals; cross-session global goals; spawning the `evaluator` *subagent* (model routing only); headless `-p "/goal ..."` mode.

## State machine (session-scoped singleton)

```
            /goal <cond>
  (none) ─────────────────▶ ACTIVE ──agent_end(!willRetry, !isSubagent)──▶ evaluate (completeSimple)
                              ▲                                     │
              /goal resume    │                        NOT_MET & budget left
                              │                                     │
   PAUSED ◀──/goal pause──── ACTIVE ◀── sendUserMessage(sentinel + directive, followUp) ──┘
                              │
                     MET ─────┴──────▶ ACHIEVED (clear + ledger event)
                     ceiling / checkpoint ─▶ PAUSED (await /goal resume)
                     work error / eval error ─▶ PAUSED (surface)
                     /goal clear | /clear ────▶ (none)
```

## Settings (`goal` block in `~/.pi/agent/settings.json`, all optional)

```jsonc
"goal": {
  "maxTurns": 25,        // pause on hit (0 = unlimited / full-auto)
  "maxTokens": 0,        // cumulative context-growth ceiling; 0 = off
  "checkpointEvery": 0,  // 0 = off; N = pause-to-confirm every N turns
  "evaluatorRole": "evaluator"
}
```

---

# Phase 0 — Commit the roadmap (highest priority; do this before any new code)

The entire M0–M7 roadmap (~81 files) is implemented and CI-green but uncommitted. One bad `git checkout .` erases it. Commit in dependency-ordered slices so each commit typechecks. **Run in the main checkout at `~/.pi`.** Do not modify any file contents in this phase; if `git status` at execution time differs from the groupings below, group by the same themes rather than aborting.

### Task 1: Verify green, then commit in ordered slices

**Step 1: Confirm the tree is the known-good state**

Run: `bun run ci`
Expected: typecheck + lint clean, all tests pass (474 at time of writing). Do not commit a red tree — if anything fails, stop and surface it.

**Step 2: Commit slice by slice**

Each slice below lists `git add` targets then a commit. After each commit run `bun run typecheck` (fast) to prove the committed tree stands on its own; the ordering below puts pure modules before the `src/index.ts` wiring that imports them.

```bash
# Slice 1 — M0/M1: default-fail contracts + verification gate (pure modules + ADR)
git add src/spec/ tests/spec/ src/permissions/yolo-config.ts tests/permissions/yolo-config.test.ts docs/adr/0006-completion-verification-gate.md
git commit -m "feat(spec): default-fail contracts + completion verification gate (M0/M1)"

# Slice 2 — agents: evaluator + focused critics + routing config
git add agent/agents/ src/agents/ tests/agents/ agent/settings.example.json
git commit -m "feat(agents): evaluator, review critics, reasoning-sandwich routing (M2/M3)"

# Slice 3 — M2: review jury
git add src/review/ tests/review/
git commit -m "feat(review): heterogeneous jury dispatch builder (M2)"

# Slice 4 — M6: bounded waves
git add src/waves/ tests/waves/
git commit -m "feat(waves): bounded wave plans, prompts, handoff verification (M6)"

# Slice 5 — M7: observability ledger + docs
git add src/observability/ tests/observability/ docs/harness-evolution.md
git commit -m "feat(observability): harness evolution ledger + change manifests (M7)"

# Slice 6 — M4: delivery gates
git add .thanos/
git commit -m "chore(governance): repo delivery gates incl. bun audit scan (M4)"

# Slice 7 — wiring: index, slash commands, welcome header + their tests
git add src/index.ts src/commands/ src/welcome/ tests/index.test.ts tests/index.modes.test.ts tests/commands/ tests/welcome/ tests/hooks/
git commit -m "feat(harness): wire gate, jury, waves, ledger into session hooks"

# Slice 8 — skills migration AS-IS (no consolidation — deliberate; all grill*/thermo* families stay)
git add -A agent/skills/
git commit -m "chore(skills): land skills migration as-is"

# Slice 9 — remaining docs + README + anything left
git add -A
git commit -m "docs: roadmap plan, orchestrator workflow, README updates"
```

**Step 3: Final verification**

Run: `git status --short` → empty. Run: `bun run ci` → green.

### Task 2: Prune stale credential backups (disk hygiene, not git)

These are all gitignored (verified) — this is disk-only cleanup of files containing live keys.

**Step 1:** List them: `ls -la ~/.pi/agent/*.bak* ~/.pi/agent/agents.bak/ 2>/dev/null`

**Step 2:** Keep only the **newest** `models.json.bak-*` and the **newest** `auth.json.bak-*`; delete the rest, plus `settings.json.bak` and `agent/agents.bak/` (superseded by git history now that Slice 2 committed `agent/agents/`).

```bash
cd ~/.pi/agent
ls -t models.json.bak-* | tail -n +2 | xargs -r rm --
ls -t auth.json.bak-* | tail -n +2 | xargs -r rm --
rm -f settings.json.bak && rm -rf agents.bak/
```

**Step 3:** Verify: `ls agent/ | grep -c bak` → at most 2. No commit needed (all ignored).

---

# Phase 1 — `/goal` command (merged design, four fixes applied)

### Task 3: Types + settings defaults

**Files:**
- Create: `src/goal/types.ts`
- Test: `tests/goal/types.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_GOAL_SETTINGS, resolveGoalSettings } from "../../src/goal/types";

describe("goal settings", () => {
  it("has the approved defaults", () => {
    expect(DEFAULT_GOAL_SETTINGS).toEqual({
      maxTurns: 25, maxTokens: 0, checkpointEvery: 0, evaluatorRole: "evaluator",
    });
  });

  it("merges partial overrides onto defaults", () => {
    expect(resolveGoalSettings({ maxTurns: 5 })).toMatchObject({ maxTurns: 5, maxTokens: 0 });
  });

  it("treats undefined as all-defaults", () => {
    expect(resolveGoalSettings(undefined)).toEqual(DEFAULT_GOAL_SETTINGS);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/goal/types.test.ts`
Expected: FAIL — cannot find module `src/goal/types`.

**Step 3: Write minimal implementation**

```ts
// src/goal/types.ts
export interface GoalSettings {
  maxTurns: number;        // pause on hit; 0 = unlimited
  /**
   * Cumulative context-growth ceiling, NOT a spend cap. Accumulated as
   * max(0, tokensNow - lastTokens) per evaluated turn, so compaction
   * (which shrinks context) can never make the counter go backwards.
   */
  maxTokens: number;       // pause on hit; 0 = off
  checkpointEvery: number; // pause every N turns; 0 = off
  evaluatorRole: string;   // model-routing role for the evaluator
}

export const DEFAULT_GOAL_SETTINGS: GoalSettings = {
  maxTurns: 25, maxTokens: 0, checkpointEvery: 0, evaluatorRole: "evaluator",
};

export function resolveGoalSettings(partial?: Partial<GoalSettings>): GoalSettings {
  return { ...DEFAULT_GOAL_SETTINGS, ...(partial ?? {}) };
}

export type GoalStatus = "active" | "paused" | "achieved";

export interface GoalSnapshot {
  condition: string;
  status: GoalStatus;
  startedAt: number;
  turnsEvaluated: number;
  tokensUsed: number;      // cumulative clamped growth (Fix 4)
  lastReason?: string;
  achieved?: { at: number; reason: string; turns: number };
}

export interface Verdict { met: boolean; reason: string }

export type PauseWhy = "ceiling-turns" | "ceiling-tokens" | "checkpoint" | "work-error" | "eval-error";

export type LoopAction =
  | { kind: "continue"; directive: string }
  | { kind: "achieved"; reason: string; turns: number }
  | { kind: "paused"; why: PauseWhy; detail: string }
  | { kind: "noop" };
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/goal/types.test.ts` → PASS.

**Step 5: Commit**

```bash
git add src/goal/types.ts tests/goal/types.test.ts
git commit -m "feat(goal): types + settings defaults"
```

### Task 4: Verdict parsing (fail-safe)

**Files:**
- Create: `src/goal/verdict.ts`
- Test: `tests/goal/verdict.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseVerdict } from "../../src/goal/verdict";

describe("parseVerdict", () => {
  it("parses MET", () => {
    expect(parseVerdict("VERDICT: MET\nREASON: all tests pass"))
      .toEqual({ met: true, reason: "all tests pass" });
  });

  it("parses NOT_MET case-insensitively and with surrounding text", () => {
    expect(parseVerdict("blah\nverdict: not_met\nreason: 2 tests failing\nmore"))
      .toEqual({ met: false, reason: "2 tests failing" });
  });

  it("treats unparseable output as NOT_MET (fail-safe)", () => {
    const v = parseVerdict("I think it looks good?");
    expect(v.met).toBe(false);
    expect(v.reason).toMatch(/unreadable/i);
  });

  it("defaults reason when REASON line missing", () => {
    expect(parseVerdict("VERDICT: MET")).toEqual({ met: true, reason: "condition met" });
  });
});
```

**Step 2: Run** `bunx vitest run tests/goal/verdict.test.ts` → FAIL (no module).

**Step 3: Implement**

```ts
// src/goal/verdict.ts
import type { Verdict } from "./types";

export function parseVerdict(text: string): Verdict {
  const verdictMatch = text.match(/VERDICT:\s*(MET|NOT_MET)/i);
  if (!verdictMatch) {
    const head = text.trim().replace(/\s+/g, " ").slice(0, 120);
    return { met: false, reason: `evaluator output unreadable: ${head}` };
  }
  const met = verdictMatch[1].toUpperCase() === "MET";
  const reasonMatch = text.match(/REASON:\s*(.+)/i);
  const reason = reasonMatch ? reasonMatch[1].trim() : met ? "condition met" : "condition not met";
  return { met, reason };
}
```

**Step 4: Run** → PASS.

**Step 5: Commit** `git commit -m "feat(goal): fail-safe verdict parsing"`

### Task 5: Directive + evaluator-context builders, with the goal sentinel (Fix 1, part 1)

**Files:**
- Create: `src/goal/prompts.ts`
- Test: `tests/goal/prompts.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  buildDirective, buildFirstDirective, buildEvaluatorContext,
  EVALUATOR_SYSTEM, GOAL_DIRECTIVE_SENTINEL,
} from "../../src/goal/prompts";

describe("goal directives", () => {
  it("every directive starts with the goal sentinel", () => {
    expect(buildFirstDirective("all tests pass").startsWith(GOAL_DIRECTIVE_SENTINEL)).toBe(true);
    expect(buildDirective("all tests pass", "2 failing").startsWith(GOAL_DIRECTIVE_SENTINEL)).toBe(true);
  });

  it("continuation directive includes condition, reason, and an evidence nudge", () => {
    const d = buildDirective("all tests pass", "2 failing in auth");
    expect(d).toContain("all tests pass");
    expect(d).toContain("2 failing in auth");
    expect(d).toMatch(/evidence/i);
  });
});

describe("buildEvaluatorContext", () => {
  it("puts condition + last turn window in the user message, no tools", () => {
    const ctx = buildEvaluatorContext({
      condition: "tests pass",
      lastAssistantText: "ran npm test, 0 failures",
      toolResultsText: "exit 0",
      previousReason: "was 1 failing",
    });
    expect(ctx.systemPrompt).toBe(EVALUATOR_SYSTEM);
    expect(ctx.tools).toBeUndefined();
    expect(ctx.messages).toHaveLength(1);
    const body = ctx.messages[0].content as string;
    expect(body).toContain("tests pass");
    expect(body).toContain("0 failures");
    expect(body).toContain("exit 0");
    expect(body).toContain("was 1 failing");
  });

  it("forces the VERDICT/REASON protocol in the system prompt", () => {
    expect(EVALUATOR_SYSTEM).toContain("VERDICT:");
    expect(EVALUATOR_SYSTEM).toContain("REASON:");
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement**

```ts
// src/goal/prompts.ts
import type { Context } from "@earendil-works/pi-ai";

/**
 * Marks every goal-injected user message. before_agent_start treats this like
 * GATE_CONTINUE_SENTINEL: it skips spec.startTurn(), so a goal turn never
 * regenerates the spec or wipes collected evidence (see src/index.ts:1328).
 */
export const GOAL_DIRECTIVE_SENTINEL = "[harness:goal-directive]";

export const EVALUATOR_SYSTEM = [
  "You are a fresh completion checker. You did NOT do the work.",
  "Decide ONLY from the evidence surfaced below whether the condition is met.",
  "You cannot run tools; if the evidence does not prove the condition, it is NOT met.",
  "Reply in exactly this format and nothing else:",
  "VERDICT: MET|NOT_MET",
  "REASON: <one short line>",
].join("\n");

export function buildFirstDirective(condition: string): string {
  return [
    `${GOAL_DIRECTIVE_SENTINEL} Work toward this goal until it is met:`,
    "",
    condition,
    "",
    "When you believe it is met, surface the evidence (test output, git status, counts) in your reply so it can be verified.",
  ].join("\n");
}

export function buildDirective(condition: string, reason: string): string {
  return [
    `${GOAL_DIRECTIVE_SENTINEL} Goal not yet met.`,
    "",
    condition,
    "",
    `Not yet met: ${reason}. Continue toward the condition.`,
    "When you believe it is met, surface the evidence (test output, git status, counts) in your reply so it can be verified.",
  ].join("\n");
}

export interface EvaluatorInput {
  condition: string;
  lastAssistantText: string;
  toolResultsText: string;
  previousReason?: string;
}

export function buildEvaluatorContext(input: EvaluatorInput): Context {
  const body = [
    `CONDITION:\n${input.condition}`,
    input.previousReason ? `\nPREVIOUS CHECK:\n${input.previousReason}` : "",
    `\nLAST ASSISTANT MESSAGE:\n${input.lastAssistantText || "(empty)"}`,
    `\nLAST TOOL RESULTS:\n${input.toolResultsText || "(none)"}`,
  ].join("\n");
  return { systemPrompt: EVALUATOR_SYSTEM, messages: [{ role: "user", content: body, timestamp: Date.now() }] };
}
```

> If `UserMessage` rejects the object literal (e.g. `timestamp` optionality), adjust to the exact `Message` shape in `pi-ai/dist/types.d.ts:265` — verified there as `{ role: "user"; content: string | (...)[]; timestamp: number }`.

**Step 4: Run** → PASS. Then `bun run typecheck`.

**Step 5: Commit** `git commit -m "feat(goal): sentinel-carrying directives + evaluator context"`

### Task 6: Last-turn extraction — mandatory tool-result evidence (Fix 2)

The evaluator's entire value is judging *evidence*, not the assistant's claims. This module extracts the last work turn's assistant text and tool results from `event.messages`. It is a hard dependency of the wiring task, not a fill-in-later.

**Files:**
- Create: `src/goal/extract.ts`
- Test: `tests/goal/extract.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { extractLastTurn, readWillRetry } from "../../src/goal/extract";

const user = (text: string) => ({ role: "user", content: text, timestamp: 1 });
const assistant = (text: string) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  timestamp: 2,
});
const toolResult = (toolName: string, text: string, isError = false) => ({
  role: "toolResult", toolCallId: "t1", toolName,
  content: [{ type: "text", text }], isError, timestamp: 3,
});

describe("extractLastTurn", () => {
  it("collects assistant text and tool results after the last user message", () => {
    const out = extractLastTurn([
      user("old prompt"), assistant("old work"), toolResult("bash", "old output"),
      user("continue"), assistant("ran the tests"), toolResult("bash", "4 passed, 0 failed"),
    ] as never[]);
    expect(out.lastAssistantText).toBe("ran the tests");
    expect(out.toolResultsText).toContain("4 passed, 0 failed");
    expect(out.toolResultsText).toContain("bash");
    expect(out.toolResultsText).not.toContain("old output");
  });

  it("marks errored tool results", () => {
    const out = extractLastTurn([
      user("go"), assistant("trying"), toolResult("bash", "boom", true),
    ] as never[]);
    expect(out.toolResultsText).toMatch(/error/i);
  });

  it("clips oversized tool output, keeping the tail", () => {
    const out = extractLastTurn([
      user("go"), assistant("x"), toolResult("bash", `${"a".repeat(20000)}TAIL`),
    ] as never[]);
    expect(out.toolResultsText.length).toBeLessThanOrEqual(9000);
    expect(out.toolResultsText).toContain("TAIL");
  });

  it("handles an empty/absent turn safely", () => {
    expect(extractLastTurn([] as never[])).toEqual({ lastAssistantText: "", toolResultsText: "" });
  });
});

describe("readWillRetry", () => {
  it("reads a boolean willRetry when present, defaults false", () => {
    expect(readWillRetry({ willRetry: true })).toBe(true);
    expect(readWillRetry({ willRetry: false })).toBe(false);
    expect(readWillRetry({})).toBe(false);
    expect(readWillRetry(undefined)).toBe(false);
  });
});
```

**Step 2: Run** `bunx vitest run tests/goal/extract.test.ts` → FAIL.

**Step 3: Implement**

```ts
// src/goal/extract.ts
const MAX_TOOL_TEXT = 8000;

interface ExtractedTurn {
  lastAssistantText: string;
  toolResultsText: string;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: "text"; text: string } =>
      typeof c === "object" && c !== null && (c as { type?: string }).type === "text")
    .map((c) => c.text)
    .join("\n");
}

/**
 * Extract the last work turn (everything after the final user message) so the
 * tool-less evaluator judges evidence, not the assistant's claims. Tool output
 * is clipped from the head (test summaries/exit codes live at the tail).
 */
export function extractLastTurn(messages: readonly unknown[]): ExtractedTurn {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as { role?: string }).role === "user") { start = i + 1; break; }
  }
  const assistantParts: string[] = [];
  const toolParts: string[] = [];
  for (const raw of messages.slice(start)) {
    const m = raw as { role?: string; toolName?: string; isError?: boolean; content?: unknown };
    if (m.role === "assistant") assistantParts.push(textOf(m.content));
    if (m.role === "toolResult") {
      const flag = m.isError ? " (ERROR)" : "";
      toolParts.push(`[${m.toolName ?? "tool"}${flag}]\n${textOf(m.content)}`);
    }
  }
  let toolResultsText = toolParts.join("\n\n");
  if (toolResultsText.length > MAX_TOOL_TEXT) {
    toolResultsText = `…(clipped)\n${toolResultsText.slice(-MAX_TOOL_TEXT)}`;
  }
  return { lastAssistantText: assistantParts.join("\n").trim(), toolResultsText };
}

/**
 * The typed extension AgentEndEvent declares only `messages`; willRetry is a
 * session-level field that may not be passed through. Read defensively.
 */
export function readWillRetry(event: unknown): boolean {
  return typeof event === "object" && event !== null &&
    (event as { willRetry?: unknown }).willRetry === true;
}
```

**Step 4: Run** → PASS. `bun run typecheck`.

**Step 5: Commit** `git commit -m "feat(goal): last-turn evidence extraction + defensive willRetry"`

### Task 7: Command parsing (verbs + aliases)

**Files:**
- Create: `src/goal/command-parse.ts`
- Test: `tests/goal/command-parse.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseGoalCommand } from "../../src/goal/command-parse";

describe("parseGoalCommand", () => {
  it("no args → status", () => {
    expect(parseGoalCommand("")).toEqual({ type: "status" });
    expect(parseGoalCommand("   ")).toEqual({ type: "status" });
  });
  it("clear + aliases", () => {
    for (const a of ["clear", "stop", "off", "reset", "none", "cancel", "CLEAR"]) {
      expect(parseGoalCommand(a)).toEqual({ type: "clear" });
    }
  });
  it("pause / resume", () => {
    expect(parseGoalCommand("pause")).toEqual({ type: "pause" });
    expect(parseGoalCommand("resume")).toEqual({ type: "resume" });
  });
  it("anything else → set with trimmed condition", () => {
    expect(parseGoalCommand("  all tests pass  ")).toEqual({ type: "set", condition: "all tests pass" });
  });
  it("a condition that starts with a keyword but has more words is a set", () => {
    expect(parseGoalCommand("stop the flaky test from failing"))
      .toEqual({ type: "set", condition: "stop the flaky test from failing" });
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement**

```ts
// src/goal/command-parse.ts
export type GoalCommand =
  | { type: "status" }
  | { type: "clear" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "set"; condition: string };

const CLEAR_ALIASES = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);

export function parseGoalCommand(args: string): GoalCommand {
  const trimmed = args.trim();
  if (trimmed === "") return { type: "status" };
  const lower = trimmed.toLowerCase();
  if (CLEAR_ALIASES.has(lower)) return { type: "clear" };
  if (lower === "pause") return { type: "pause" };
  if (lower === "resume") return { type: "resume" };
  return { type: "set", condition: trimmed };
}
```

**Step 4: Run** → PASS.

**Step 5: Commit** `git commit -m "feat(goal): command verb + alias parsing"`

### Task 8: GoalController — set/clear/status/pause/resume

**Files:**
- Create: `src/goal/controller.ts`
- Test: `tests/goal/controller.set.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { GoalController } from "../../src/goal/controller";

const now = () => 1000;

describe("GoalController set/clear", () => {
  it("rejects empty condition", () => {
    const c = new GoalController({}, now);
    expect(c.set("   ", 0).ok).toBe(false);
  });
  it("rejects >4000 chars", () => {
    const c = new GoalController({}, now);
    expect(c.set("x".repeat(4001), 0).ok).toBe(false);
  });
  it("sets an active goal; first directive carries the sentinel + condition", () => {
    const c = new GoalController({}, now);
    const r = c.set("all tests pass", 500);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.replaced).toBe(false);
      expect(r.firstDirective).toContain("all tests pass");
      expect(r.firstDirective).toContain("[harness:goal-directive]");
    }
    expect(c.snapshot()).toMatchObject({
      condition: "all tests pass", status: "active", turnsEvaluated: 0, tokensUsed: 0,
    });
  });
  it("replacing an active goal reports replaced:true", () => {
    const c = new GoalController({}, now);
    c.set("a", 0);
    const r = c.set("b", 0);
    expect(r.ok && r.replaced).toBe(true);
    expect(c.snapshot()?.condition).toBe("b");
  });
  it("clear removes the goal", () => {
    const c = new GoalController({}, now);
    c.set("a", 0); c.clear();
    expect(c.snapshot()).toBeUndefined();
  });
});

describe("GoalController pause/resume", () => {
  it("pause moves active→paused; resume moves back", () => {
    const c = new GoalController({}, now);
    c.set("a", 0);
    expect(c.pause()).toBe(true);
    expect(c.snapshot()?.status).toBe("paused");
    expect(c.resume()).toBe(true);
    expect(c.snapshot()?.status).toBe("active");
  });
  it("pause when not active / resume when not paused return false", () => {
    const c = new GoalController({}, now);
    expect(c.pause()).toBe(false);
    c.set("a", 0);
    expect(c.resume()).toBe(false);
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement (loop core added in Task 9)**

```ts
// src/goal/controller.ts
import { buildDirective, buildFirstDirective } from "./prompts";
import { resolveGoalSettings, type GoalSettings, type GoalSnapshot, type LoopAction, type Verdict } from "./types";

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
```

**Step 4: Run** → PASS. `bun run typecheck`.

**Step 5: Commit** `git commit -m "feat(goal): controller set/clear/pause/resume"`

### Task 9: GoalController — onTurnResult with cumulative token accounting (Fix 4)

**Files:**
- Modify: `src/goal/controller.ts`
- Test: `tests/goal/controller.loop.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { GoalController } from "../../src/goal/controller";

const met = { met: true, reason: "done" };
const notMet = { met: false, reason: "still failing" };

describe("onTurnResult", () => {
  it("no active goal → noop", () => {
    expect(new GoalController().onTurnResult(notMet, 0)).toEqual({ kind: "noop" });
  });

  it("MET → achieved with turn count, and status becomes achieved", () => {
    const c = new GoalController(); c.set("a", 0);
    expect(c.onTurnResult(met, 10)).toEqual({ kind: "achieved", reason: "done", turns: 1 });
    expect(c.snapshot()?.status).toBe("achieved");
  });

  it("NOT_MET with budget left → continue with directive containing sentinel + reason", () => {
    const c = new GoalController({ maxTurns: 25 }); c.set("cond", 0);
    const action = c.onTurnResult(notMet, 5);
    expect(action.kind).toBe("continue");
    if (action.kind === "continue") {
      expect(action.directive).toContain("still failing");
      expect(action.directive).toContain("[harness:goal-directive]");
    }
    expect(c.snapshot()?.turnsEvaluated).toBe(1);
    expect(c.snapshot()?.lastReason).toBe("still failing");
  });

  it("hitting maxTurns → paused (ceiling-turns), not cleared", () => {
    const c = new GoalController({ maxTurns: 2 }); c.set("cond", 0);
    expect(c.onTurnResult(notMet, 0).kind).toBe("continue");
    expect(c.onTurnResult(notMet, 0)).toMatchObject({ kind: "paused", why: "ceiling-turns" });
    expect(c.snapshot()?.status).toBe("paused");
  });

  it("accumulates clamped token growth; ceiling fires on cumulative use", () => {
    const c = new GoalController({ maxTurns: 0, maxTokens: 150 }); c.set("cond", 1000);
    expect(c.onTurnResult(notMet, 1100).kind).toBe("continue"); // +100 → 100
    const action = c.onTurnResult(notMet, 1160);                 // +60 → 160 ≥ 150
    expect(action).toMatchObject({ kind: "paused", why: "ceiling-tokens" });
    expect(c.snapshot()?.tokensUsed).toBe(160);
  });

  it("compaction (context shrink) never decrements the counter", () => {
    const c = new GoalController({ maxTurns: 0, maxTokens: 500 }); c.set("cond", 1000);
    c.onTurnResult(notMet, 1200);            // +200 → 200
    const a = c.onTurnResult(notMet, 300);   // shrank: clamp to +0 → still 200
    expect(a.kind).toBe("continue");
    expect(c.snapshot()?.tokensUsed).toBe(200);
    c.onTurnResult(notMet, 400);             // +100 → 300 (baseline rebased to 300)
    expect(c.snapshot()?.tokensUsed).toBe(300);
  });

  it("checkpointEvery N → paused (checkpoint) on the Nth turn", () => {
    const c = new GoalController({ maxTurns: 0, checkpointEvery: 2 }); c.set("cond", 0);
    expect(c.onTurnResult(notMet, 0).kind).toBe("continue");
    expect(c.onTurnResult(notMet, 0)).toMatchObject({ kind: "paused", why: "checkpoint" });
  });

  it("paused goal ignores turn results → noop", () => {
    const c = new GoalController(); c.set("a", 0); c.pause();
    expect(c.onTurnResult(notMet, 0)).toEqual({ kind: "noop" });
  });

  it("onError pauses an active goal with the error kind", () => {
    const c = new GoalController(); c.set("a", 0);
    expect(c.onError("eval-error", "boom")).toMatchObject({ kind: "paused", why: "eval-error" });
    expect(c.snapshot()?.status).toBe("paused");
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement (add to controller)**

```ts
  onTurnResult(verdict: Verdict, tokensNow: number): LoopAction {
    if (!this.g || this.g.status !== "active") return { kind: "noop" };
    // Context size can shrink after compaction; clamp so the ceiling counter
    // is monotone (this is a growth guard, not a spend meter — see types.ts).
    this.g.tokensUsed += Math.max(0, tokensNow - this.g.lastTokens);
    this.g.lastTokens = tokensNow;
    this.g.turnsEvaluated += 1;
    this.g.lastReason = verdict.reason;

    if (verdict.met) {
      this.g.status = "achieved";
      this.g.achieved = { at: this.now(), reason: verdict.reason, turns: this.g.turnsEvaluated };
      return { kind: "achieved", reason: verdict.reason, turns: this.g.turnsEvaluated };
    }

    const { maxTurns, maxTokens, checkpointEvery } = this.settings;
    if (maxTurns > 0 && this.g.turnsEvaluated >= maxTurns) {
      this.g.status = "paused";
      return { kind: "paused", why: "ceiling-turns", detail: `Reached ${maxTurns}-turn ceiling.` };
    }
    if (maxTokens > 0 && this.g.tokensUsed >= maxTokens) {
      this.g.status = "paused";
      return { kind: "paused", why: "ceiling-tokens", detail: `Reached ${maxTokens}-token growth ceiling.` };
    }
    if (checkpointEvery > 0 && this.g.turnsEvaluated % checkpointEvery === 0) {
      this.g.status = "paused";
      return { kind: "paused", why: "checkpoint", detail: `Checkpoint after ${this.g.turnsEvaluated} turns.` };
    }
    return { kind: "continue", directive: buildDirective(this.g.condition, verdict.reason) };
  }

  onError(kind: "work-error" | "eval-error", detail: string): LoopAction {
    if (!this.g || this.g.status !== "active") return { kind: "noop" };
    this.g.status = "paused";
    return { kind: "paused", why: kind, detail };
  }
```

**Step 4: Run** → PASS. `bun run typecheck`.

**Step 5: Commit** `git commit -m "feat(goal): loop core with clamped cumulative token ceiling"`

### Task 10: Gate coordination — suppress re-injection while a goal is active (Fix 1, part 2)

**Files:**
- Modify: `src/spec/gate.ts`
- Modify: `src/index.ts:1466-1471` (add `goalActive` to the `shouldReinject` call — done in Task 16 wiring; here only the pure module + its call-site type)
- Test: `tests/spec/gate.test.ts`

**Step 1: Write the failing test (add to the existing describe block)**

```ts
it("does not re-inject while a goal is active (goal loop is the only driver)", () => {
  expect(shouldReinject({
    results: [crit(false)], attempts: 0, isSubagent: false, enabled: true, goalActive: true,
  })).toBe(false);
});
```

Also update every existing `shouldReinject` test call in `tests/spec/gate.test.ts` to pass `goalActive: false`.

**Step 2: Run** `bunx vitest run tests/spec/gate.test.ts` → FAIL (excess property / undefined behavior).

**Step 3: Implement**

In `src/spec/gate.ts`, extend the input and guard:

```ts
export interface ReinjectInputs {
  results: VerificationResult[];
  attempts: number;
  isSubagent: boolean;
  enabled: boolean;
  /** While a /goal is active, the goal evaluator is the sole continuation driver. */
  goalActive: boolean;
}

export function shouldReinject(input: ReinjectInputs): boolean {
  if (!input.enabled) return false;
  if (input.goalActive) return false;
  if (input.isSubagent) return false;
  if (input.results.length === 0) return false;
  if (input.attempts >= GATE_MAX_ATTEMPTS) return false;
  return input.results.some((r) => !r.passed);
}
```

Update the existing call in `src/index.ts` to pass `goalActive: false` for now (a temporary literal — Task 16 replaces it with `goalController.isActive()`), so this task compiles standalone.

**Step 4: Run** `bunx vitest run tests/spec/gate.test.ts && bun run typecheck` → PASS.

**Step 5: Commit** `git commit -m "feat(spec): gate defers to an active /goal loop"`

### Task 11: Persistence — status survives resume (Fix 3)

**Files:**
- Create: `src/goal/persist.ts`
- Test: `tests/goal/persist.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { GoalController } from "../../src/goal/controller";
import { serializeGoal, restoreController } from "../../src/goal/persist";

describe("goal persistence", () => {
  it("serializes an active goal with its status", () => {
    const c = new GoalController(); c.set("cond", 500);
    expect(serializeGoal(c)).toEqual({ condition: "cond", status: "active" });
  });
  it("serializes a paused goal as paused", () => {
    const c = new GoalController(); c.set("cond", 0); c.pause();
    expect(serializeGoal(c)).toEqual({ condition: "cond", status: "paused" });
  });
  it("does not serialize achieved/cleared goals", () => {
    const c = new GoalController(); c.set("cond", 0);
    c.onTurnResult({ met: true, reason: "x" }, 0);
    expect(serializeGoal(c)).toBeUndefined();
    const c2 = new GoalController();
    expect(serializeGoal(c2)).toBeUndefined();
  });
  it("restore rebuilds an active goal with reset baselines", () => {
    const c = restoreController({ condition: "cond", status: "active" }, { maxTurns: 25 }, () => 42, 900);
    expect(c.snapshot()).toMatchObject({
      condition: "cond", status: "active", turnsEvaluated: 0, startedAt: 42, tokensUsed: 0,
    });
  });
  it("restore keeps a paused goal paused (it must not silently auto-loop)", () => {
    const c = restoreController({ condition: "cond", status: "paused" }, undefined, () => 42, 0);
    expect(c.snapshot()?.status).toBe("paused");
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement**

```ts
// src/goal/persist.ts
import { GoalController } from "./controller";
import type { GoalSettings } from "./types";

export interface GoalPersistPayload {
  condition: string;
  status: "active" | "paused";
}

export function serializeGoal(c: GoalController): GoalPersistPayload | undefined {
  const s = c.snapshot();
  if (!s || s.status === "achieved") return undefined;
  return { condition: s.condition, status: s.status };
}

export function restoreController(
  payload: GoalPersistPayload,
  settings: Partial<GoalSettings> | undefined,
  now: () => number,
  tokensNow: number,
): GoalController {
  const c = new GoalController(settings, now);
  c.set(payload.condition, tokensNow); // resets turns/timer/token baseline by design
  if (payload.status === "paused") c.pause();
  return c;
}
```

**Step 4: Run** → PASS.

**Step 5: Commit** `git commit -m "feat(goal): status-preserving persistence for --resume"`

### Task 12: Ledger events for the goal lifecycle

**Files:**
- Modify: `src/observability/harness-ledger.ts:6-13` (extend the union)
- Test: `tests/observability/harness-ledger.test.ts`

**Step 1: Write the failing test (add to the existing describe)**

```ts
it("accepts goal lifecycle event types", () => {
  for (const type of ["goal_set", "goal_achieved", "goal_paused"] as const) {
    const line = serializeHarnessEvent({
      type, taskId: "s1", summary: "x", outcome: "ok",
      createdAt: "2026-07-02T00:00:00.000Z",
    });
    expect(JSON.parse(line).type).toBe(type);
  }
});
```

**Step 2: Run** `bunx vitest run tests/observability/harness-ledger.test.ts` → FAIL (type error).

**Step 3: Implement** — extend `HarnessEventType`:

```ts
export type HarnessEventType =
  | "gate_failure"
  | "gate_pass"
  | "review_disagreement"
  | "wave_handoff_rejected"
  | "delivery_gate_failed"
  | "manual_override"
  | "harness_change"
  | "goal_set"
  | "goal_achieved"
  | "goal_paused";
```

**Step 4: Run** → PASS.

**Step 5: Commit** `git commit -m "feat(observability): goal lifecycle ledger events"`

### Task 13: Loop handler (thin, injected side-effects)

**Files:**
- Create: `src/goal/loop.ts`
- Test: `tests/goal/loop.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { GoalController } from "../../src/goal/controller";
import { handleAgentEnd, type LoopDeps } from "../../src/goal/loop";

function deps(overrides: Partial<LoopDeps> = {}): LoopDeps {
  return {
    controller: new GoalController({ maxTurns: 25 }),
    runEvaluator: vi.fn(async () => ({ met: false, reason: "still failing" })),
    sendDirective: vi.fn(async () => {}),
    notify: vi.fn(),
    recordEvent: vi.fn(async () => {}),
    getTokens: () => 100,
    isSubagent: false,
    ...overrides,
  };
}

describe("handleAgentEnd", () => {
  it("does nothing inside a subagent", async () => {
    const d = deps({ isSubagent: true }); d.controller.set("a", 0);
    await handleAgentEnd(d, { willRetry: false, lastAssistantText: "", toolResultsText: "" });
    expect(d.runEvaluator).not.toHaveBeenCalled();
  });

  it("skips when willRetry is true", async () => {
    const d = deps(); d.controller.set("a", 0);
    await handleAgentEnd(d, { willRetry: true, lastAssistantText: "", toolResultsText: "" });
    expect(d.runEvaluator).not.toHaveBeenCalled();
  });

  it("NOT_MET → sends the continuation directive", async () => {
    const d = deps(); d.controller.set("cond", 0);
    await handleAgentEnd(d, { willRetry: false, lastAssistantText: "x", toolResultsText: "y" });
    expect(d.sendDirective).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.sendDirective).mock.calls[0][0]).toContain("still failing");
  });

  it("MET → notifies achievement + records goal_achieved, no further directive", async () => {
    const d = deps({ runEvaluator: vi.fn(async () => ({ met: true, reason: "done" })) });
    d.controller.set("cond", 0);
    await handleAgentEnd(d, { willRetry: false, lastAssistantText: "", toolResultsText: "" });
    expect(d.sendDirective).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalled();
    expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "goal_achieved" }));
  });

  it("pause (ceiling) → notifies + records goal_paused", async () => {
    const d = deps({ controller: new GoalController({ maxTurns: 1 }) });
    d.controller.set("cond", 0);
    await handleAgentEnd(d, { willRetry: false, lastAssistantText: "", toolResultsText: "" });
    expect(d.sendDirective).not.toHaveBeenCalled();
    expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "goal_paused" }));
  });

  it("evaluator throwing twice → pauses (eval-error), no directive", async () => {
    const runEvaluator = vi.fn(async () => { throw new Error("boom"); });
    const d = deps({ runEvaluator }); d.controller.set("cond", 0);
    await handleAgentEnd(d, { willRetry: false, lastAssistantText: "", toolResultsText: "" });
    expect(runEvaluator).toHaveBeenCalledTimes(2); // one retry
    expect(d.sendDirective).not.toHaveBeenCalled();
    expect(d.controller.snapshot()?.status).toBe("paused");
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement**

```ts
// src/goal/loop.ts
import type { GoalController } from "./controller";
import type { Verdict } from "./types";

export interface AgentEndInfo {
  willRetry: boolean;
  lastAssistantText: string;
  toolResultsText: string;
}

export interface GoalEventRecord {
  type: "goal_set" | "goal_achieved" | "goal_paused";
  summary: string;
  outcome: string;
}

export interface LoopDeps {
  controller: GoalController;
  runEvaluator: (lastAssistantText: string, toolResultsText: string, previousReason?: string) => Promise<Verdict>;
  sendDirective: (directive: string) => Promise<void>;
  notify: (message: string, level?: "info" | "warning") => void;
  recordEvent: (event: GoalEventRecord) => Promise<void>;
  getTokens: () => number;
  isSubagent: boolean;
}

export async function handleAgentEnd(deps: LoopDeps, info: AgentEndInfo): Promise<void> {
  const { controller } = deps;
  const snap = controller.snapshot();
  if (deps.isSubagent || info.willRetry || !snap || snap.status !== "active") return;

  let verdict: Verdict;
  try {
    verdict = await deps.runEvaluator(info.lastAssistantText, info.toolResultsText, snap.lastReason);
  } catch {
    try {
      verdict = await deps.runEvaluator(info.lastAssistantText, info.toolResultsText, snap.lastReason);
    } catch (e) {
      const action = controller.onError("eval-error", `Evaluator failed: ${(e as Error).message}`);
      if (action.kind === "paused") {
        deps.notify(`◎ /goal paused — ${action.detail} Run /goal resume to continue.`, "warning");
        await deps.recordEvent({ type: "goal_paused", summary: action.detail, outcome: action.why });
      }
      return;
    }
  }

  const action = controller.onTurnResult(verdict, deps.getTokens());
  switch (action.kind) {
    case "continue":
      await deps.sendDirective(action.directive);
      break;
    case "achieved":
      deps.notify(`◎ /goal achieved in ${action.turns} turns — ${action.reason}`);
      await deps.recordEvent({ type: "goal_achieved", summary: action.reason, outcome: `turns=${action.turns}` });
      break;
    case "paused":
      deps.notify(`◎ /goal paused — ${action.detail} Run /goal resume to continue.`, "warning");
      await deps.recordEvent({ type: "goal_paused", summary: action.detail, outcome: action.why });
      break;
    case "noop":
      break;
  }
}
```

**Step 4: Run** → PASS. `bun run typecheck`.

**Step 5: Commit** `git commit -m "feat(goal): agent_end loop handler with ledger events"`

### Task 14: Evaluator call (side-channel completeSimple)

**Files:**
- Create: `src/goal/evaluator.ts`
- Test: `tests/goal/evaluator.test.ts` (unit-test the pure parts; the live call is verified in Task 16)

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { runEvaluatorWith } from "../../src/goal/evaluator";

describe("runEvaluatorWith", () => {
  it("builds the context, calls complete, and parses the verdict", async () => {
    const complete = vi.fn(async () => ({
      content: [{ type: "text", text: "VERDICT: NOT_MET\nREASON: no test output shown" }],
    }));
    const v = await runEvaluatorWith(complete as never, {
      condition: "tests pass", lastAssistantText: "did stuff", toolResultsText: "",
    });
    expect(v).toEqual({ met: false, reason: "no test output shown" });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("empty completion text is fail-safe NOT_MET", async () => {
    const complete = vi.fn(async () => ({ content: [] }));
    const v = await runEvaluatorWith(complete as never, {
      condition: "x", lastAssistantText: "", toolResultsText: "",
    });
    expect(v.met).toBe(false);
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement**

```ts
// src/goal/evaluator.ts
import { buildEvaluatorContext, type EvaluatorInput } from "./prompts";
import { parseVerdict } from "./verdict";
import type { Verdict } from "./types";

type CompleteFn = (context: ReturnType<typeof buildEvaluatorContext>) => Promise<{
  content: { type: string; text?: string }[];
}>;

/** Pure core: context → completion → verdict. The wiring binds `complete` to
 *  completeSimple(model, ctx, { reasoning: "low" }) with the model resolved
 *  from the `evaluator` routing role, else the current session model. */
export async function runEvaluatorWith(complete: CompleteFn, input: EvaluatorInput): Promise<Verdict> {
  const context = buildEvaluatorContext(input);
  const message = await complete(context);
  const text = message.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  return parseVerdict(text);
}
```

**Step 4: Run** → PASS.

**Step 5: Commit** `git commit -m "feat(goal): side-channel evaluator core"`

### Task 15: Settings example

**Files:**
- Modify: `agent/settings.example.json` — add the `goal` block with the approved defaults.

**Step 1:** Add next to the existing top-level blocks:

```jsonc
"goal": {
  "maxTurns": 25,
  "maxTokens": 0,
  "checkpointEvery": 0,
  "evaluatorRole": "evaluator"
}
```

**Step 2:** Run `bunx vitest run tests/welcome tests/index.test.ts` (settings example is exercised indirectly) and `bun run lint`.

**Step 3:** Commit `git commit -m "chore(settings): document goal defaults"`

### Task 16: Command registration + index wiring (live verification)

This task wires against the live ExtensionAPI, so it is verified by running Pi rather than unit tests alone.

**Files:**
- Create: `src/goal/command.ts` — `registerGoalCommand(pi, deps)`
- Modify: `src/index.ts`:
  - `before_agent_start` (`~:1328`): also skip `spec.startTurn` when the prompt carries `GOAL_DIRECTIVE_SENTINEL`.
  - `agent_end` (`~:1466`): replace the temporary `goalActive: false` from Task 10 with `goalController.isActive()`; after the gate block, call the goal loop.
  - Session start: read persisted goal payload → `restoreController`; on `session_shutdown`, persist via the extension entries API (`appendEntry` custom entry — confirm the exact method name on `ExtensionActions` while wiring).

**Step 1: `before_agent_start` guard (Fix 1, final piece)**

```ts
import { GOAL_DIRECTIVE_SENTINEL } from "./goal/prompts";
// ...
const isHarnessContinuation =
  event.prompt.includes(GATE_CONTINUE_SENTINEL) ||
  event.prompt.includes(GOAL_DIRECTIVE_SENTINEL);
if (!isHarnessContinuation) {
  spec.startTurn(event.prompt, pi.getFlag("spec") === true);
}
```

**Step 2: Construct the shared controller + register the loop**

Read the `goal` settings block from `agentFilePath("settings.json")` (same helper style as `src/agents/model-routing.ts:309`). Then:

```ts
const goalController = new GoalController(settings.goal);

pi.on("agent_end", async (event, ctx) => {
  const { lastAssistantText, toolResultsText } = extractLastTurn(event.messages);
  await handleAgentEnd({
    controller: goalController,
    runEvaluator: (a, t, prev) => runEvaluatorWith(
      (context) => completeSimple(resolveEvaluatorModel(ctx), context, { reasoning: "low" }),
      { condition: goalController.snapshot()!.condition, lastAssistantText: a, toolResultsText: t, previousReason: prev },
    ),
    sendDirective: (d) => pi.sendUserMessage(d, { deliverAs: "followUp" }),
    notify: (m, l) => ctx.ui.notify(m, l ?? "info"),
    recordEvent: (e) => appendHarnessEvent({
      ...e, taskId: sessionId, model: ctx.model?.id, createdAt: new Date().toISOString(),
    }),
    getTokens: () => ctx.getContextUsage()?.tokens ?? 0,
    isSubagent,
  }, {
    willRetry: readWillRetry(event),
    lastAssistantText,
    toolResultsText,
  });
});
```

`resolveEvaluatorModel(ctx)`: `evaluator` role override from model routing when configured, else `ctx.model` — reuse the resolution helpers in `src/agents/model-routing.ts`. In the *gate* block of the same handler, pass `goalActive: goalController.isActive()` to `shouldReinject`.

> Ordering note: keep the goal-loop call AFTER the gate block. With Fix 1 the gate never re-injects while a goal is active, so at most one followUp is queued per `agent_end`.

**Step 3: `registerGoalCommand(pi, deps)`**

Use `pi.registerCommand("goal", { description, handler })` (mirror the existing command registrations in `src/index.ts` / `src/commands/slash.ts`). In the handler, dispatch `parseGoalCommand(args)`:
- Guard up front: refuse in subagents (main-session only) and when `!ctx.isProjectTrusted()` (with reason).
- `set` → `controller.set(condition, getTokens())`; on `ok`: notify `◎ /goal active` (include the replace notice when `replaced`), record `goal_set` to the ledger, one-time hint that permission prompts still apply, then `pi.sendUserMessage(firstDirective, { deliverAs: "followUp" })`. On `!ok`: notify the error.
- `status` → `formatPanel` from `controller.snapshot()`: condition, status, elapsed (`now - startedAt`), `turnsEvaluated`, `tokensUsed`, `lastReason`; if no goal but a previous `achieved` exists, show that.
- `clear` / `pause` / `resume` → call controller + notify outcome (each returns whether it applied).

**Step 4: Persistence wiring**

On session start (resume path), if a persisted payload exists: `restoreController(payload, settings.goal, Date.now, getTokens())` and notify `◎ /goal restored (status)`. On `session_shutdown` (and before compaction if an entries hook exists), persist `serializeGoal(controller)`; write nothing (and remove any stale entry) when it returns `undefined`. `/clear` must also drop the goal — hook the same event the session-reset path uses.

**Step 5: Typecheck + full CI**

Run: `bun run ci` → green (all goal tests + updated gate tests + untouched suites).

**Step 6: Manual end-to-end verification (use the @verify / run skill discipline)**

- `/goal echo the word DONE in your reply` → agent replies → evaluator MET → achievement notice, goal cleared, `goal_achieved` in `.harness/evolution/events.jsonl`.
- `/goal` → status panel while active; `/goal pause` / `resume` / `clear` behave; `/goal <new>` over an active goal notifies "replaced".
- Set `goal.maxTurns: 1` + an unsatisfiable condition → one turn, then `ceiling-turns` pause (not cleared); `/goal resume` continues.
- **Gate coordination check:** give a goal whose work generates an ambient-spec-failing turn; confirm NO `[harness:verify-continue]` message appears while the goal is active, and the spec panel still renders.
- **Evidence check:** condition "the test suite passes"; have the agent claim success *without* running tests → evaluator must return NOT_MET (no tool evidence). Then run the tests → MET.
- **willRetry probe:** log `readWillRetry(event)` once during a normal turn to confirm whether the runtime passes the session field through; leave the defensive default either way.
- Confirm no loop runs inside a spawned subagent.
- Capture the transcript to `.harness/design/goal-command-verification.txt`.

**Step 7: Commit**

```bash
git add src/goal/ src/index.ts .harness/design/goal-command-verification.txt 2>/dev/null || git add src/goal/ src/index.ts
git commit -m "feat(goal): register /goal command + agent_end wiring, gate-coordinated"
```

> `.harness/` is gitignored — keep the transcript on disk as evidence; do not force-add it.

### Task 17: Status widget

**Files:**
- Modify: `src/goal/command.ts` / `src/index.ts` (whichever owns `ctx.ui.setStatus` for harness indicators — mirror the `lens:<changed>` pattern)

**Step 1:** While a goal is active, set a compact status: `◎ goal:<turns>t·<tokensUsed/1000>k`; paused: `◎ goal:paused`; clear it on achieved/cleared. Update it in the loop handler's notify points (pass a `setStatus` dep alongside `notify` if cleaner).

**Step 2:** Manual verify the segment appears/disappears across set → continue → pause → clear.

**Step 3:** Commit `git commit -m "feat(goal): status indicator"`

### Task 18: Docs — README, ADR, supersede the old plan docs

**Files:**
- Modify: `README.md` — add a `/goal` section: what it does, the command verbs/aliases, the `goal` settings block, the guarded-loop/pause behavior, the sentinel/gate-coordination rule ("while a goal is active, the goal evaluator is the only continuation driver"), and the `maxTokens` = context-growth-guard caveat. Add `/goal` to the slash-command table.
- Create: `docs/adr/0007-goal-loop-single-driver.md` — short ADR (Context / Decision / Consequences) recording: side-channel evaluator (no subagent, no re-entrancy); goal sentinel skips spec regeneration; gate suppressed while goal active; fail-safe verdict; ceilings pause. Reference ADR 0006.
- Modify: `docs/plans/2026-07-01-goal-command-design.md` and `docs/plans/2026-07-01-goal-command-plan.md` — change their Status lines to `SUPERSEDED by docs/plans/2026-07-02-harness-fixes-and-goal-command.md`.
- Append a `harness_change` manifest entry per `docs/harness-evolution.md` (failure evidence: gate/goal double-driver risk found in review; predicted impact: single-driver continuation; follow-up: inspect `goal_*` ledger events after ~2 weeks of use).

**Steps:** write docs → `bun run ci` → commit `git commit -m "docs(goal): README + ADR 0007; supersede 2026-07-01 goal docs"`.

---

# Phase 2 — Close the `git <flags> push` delivery bypass

### Task 19: Argv-level git-push classifier (pure module)

**Files:**
- Create: `src/governance/push-guard.ts`
- Test: `tests/governance/push-guard.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { commandContainsGitPush } from "../../src/governance/push-guard";

describe("commandContainsGitPush", () => {
  it("catches plain and flagged push forms", () => {
    for (const cmd of [
      "git push",
      "git push origin main",
      "git push --force-with-lease",
      "git -C /home/me/repo push",
      "git -C ../repo push origin main",
      "git --no-pager push",
      "git -c user.name=x push",
      "git --git-dir=/r/.git push",
      "git --work-tree /r push",
      "cd repo && git -C . push",
      "true; git push",
      "/usr/bin/git push",
    ]) {
      expect(commandContainsGitPush(cmd), cmd).toBe(true);
    }
  });

  it("does not false-positive on benign commands", () => {
    for (const cmd of [
      'git commit -m "add push support"',
      "git log --grep push",
      "cat src/push.ts",
      "git pushy-tool",
      "echo git push",           // argv[0] is echo
      "git pull && git status",
      'grep -r "git push" docs/',
      "gh pr view 12",
    ]) {
      expect(commandContainsGitPush(cmd), cmd).toBe(false);
    }
  });

  it("respects quoting — push inside a quoted arg is not a subcommand", () => {
    expect(commandContainsGitPush('git commit -m "please push later"')).toBe(false);
    expect(commandContainsGitPush("git stash store -m 'push wip' abc")).toBe(false);
  });
});
```

**Step 2: Run** `bunx vitest run tests/governance/push-guard.test.ts` → FAIL.

**Step 3: Implement**

```ts
// src/governance/push-guard.ts
import { splitShellClauses } from "../audit/target";

/** git global options that consume a following argument (separate-token form). */
const GIT_OPTS_WITH_ARG = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);

/** Quote-aware tokenizer: quoted spans are single tokens, quotes stripped. */
function tokenize(clause: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  for (const ch of clause) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** True when any shell clause is a `git … push …` invocation, regardless of
 *  interposed global flags (`git -C dir push`, `git --no-pager push`, …).
 *  Complements the anchored globs in delivery-overlay.ts (kept for audit
 *  parity); this closes the interposed-flag bypass documented there. */
export function commandContainsGitPush(command: string): boolean {
  for (const rawClause of splitShellClauses(command)) {
    const tokens = tokenize(rawClause.trim());
    if (tokens.length < 2) continue;
    const program = tokens[0].split("/").pop();
    if (program !== "git") continue;
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (GIT_OPTS_WITH_ARG.has(t)) { i++; continue; }   // skip option + its arg
      if (t.startsWith("-")) continue;                    // skip flags & --opt=val
      // first non-flag token after `git` is the subcommand
      if (t === "push") return true;
      break;
    }
  }
  return false;
}
```

> If `splitShellClauses` splits on `;`/`&&`/`||`/`|` only (check `src/audit/target.ts:52` while implementing), that matches the policy evaluator's behavior — keep parity rather than inventing a second splitter.

**Step 4: Run** → PASS. `bun run typecheck`.

**Step 5: Commit** `git commit -m "feat(governance): argv-level git-push classifier"`

### Task 20: Wire the guard into the tool_call path + docs

**Files:**
- Modify: `src/index.ts` (the `tool_call` handler, `~:1376-1429`)
- Modify: `src/governance/delivery-overlay.ts` (update the KNOWN LIMITATION comment)
- Modify: `README.md` (shrink the `/ship` known-limitation note)
- Test: `tests/index.test.ts` or `tests/hooks/` (one focused hook test using the existing fake-pi pattern)

**Step 1: Failing hook test**

Using the existing `createFakePi()` pattern, resolve delivery as `local-only`, fire `tool_call` with `toolName: "bash"`, `input: { command: "git -C /tmp/repo push origin main" }`, and assert the handler returns `{ block: true, reason: expect.stringContaining("local-only") }`. Add a companion assertion that `git commit -m "add push support"` is NOT blocked.

**Step 2: Wire it**

In the `tool_call` handler, the delivery state is already awaited (`const delivery = await deliveryStatePromise;`). Before or immediately after the policy handler result:

```ts
import { commandContainsGitPush } from "./governance/push-guard";
// ...
if (
  delivery?.mode === "local-only" &&
  event.toolName === "bash" &&
  typeof (event.input as { command?: unknown })?.command === "string" &&
  commandContainsGitPush((event.input as { command: string }).command)
) {
  return { block: true, reason: "local-only delivery mode forbids pushing to a remote (argv-level guard)" };
}
```

Place it so a deny is returned even in unattended mode (that is exactly the residual exposure being closed). Mirror the audit-logging behavior of policy denies if straightforward; otherwise note the gap in the overlay comment.

**Step 3: Update comments/docs** — rewrite the KNOWN LIMITATION block in `delivery-overlay.ts:30-52` to state that interposed-flag `git push` forms are now caught argv-level; remaining exposure is non-git uploaders (`scp`, `rsync`, `curl`), unchanged. Update the README `/ship` limitation note to match.

**Step 4: Run** `bun run ci` → green.

**Step 5: Manual verify** — in a scratch repo registered `local-only` + `unattended`, ask the agent to run `git -C . push`; expect a block with the local-only reason. Capture to `.harness/design/push-guard-verification.txt` (disk only, gitignored).

**Step 6: Commit** `git commit -m "feat(governance): block interposed-flag git push in local-only mode"`

---

## Final verification (whole plan)

Run: `bun run ci` → typecheck + lint + all tests green (474 pre-existing + new goal/gate/push-guard suites).
Live: the Task 16 Step 6 checklist and Task 20 Step 5 both pass; `git status --short` is empty; `.harness/evolution/events.jsonl` shows `goal_set`/`goal_achieved` entries from the live checks.

## Explicitly out of scope

- **Skill consolidation** — deliberately excluded: the `grilling`/`grill-me`/`grill-with-docs` and `thermo-nuclear-*` families are intentionally distinct and all stay (Task 1 Slice 8 commits the skills tree as-is).
- Spec-contract ↔ goal-evaluator convergence (LLM-judged spec criteria) — future ADR; the single-driver rule in this plan is the prerequisite.
- OS-level bash sandboxing / network egress control; headless `-p "/goal ..."` mode; `/ship` push/PR automation; `gh`-family argv guard; multiple concurrent goals.

## Notes for the implementer

- The pure modules (Tasks 3–15, 19) are the contract; the wiring tasks (16–17, 20) adapt Pi's real event/field names. Two things to confirm live while wiring: whether the runtime passes `willRetry` through to extension `agent_end` handlers (defensive default already handles absence), and the exact `ExtensionActions` method for persisting custom entries.
- Keep the evaluator **tool-less** and **last-turn-scoped**; never send full history.
- Fail-safe everywhere: unknown/parse/eval failures must never produce a false "achieved", and ceilings always pause — never clear.
- One continuation driver at a time: gate sentinel and goal sentinel both bypass spec regeneration; the gate defers to an active goal. If you find both sending followUps in a live run, that is a bug against this plan.
