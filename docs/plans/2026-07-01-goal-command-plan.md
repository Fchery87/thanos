# `/goal` Command Implementation Plan

> **Status: SUPERSEDED** by `docs/plans/2026-07-02-harness-fixes-and-goal-command.md` (implemented 2026-07-02). Retained for history.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a session-scoped `/goal` command that sets a completion condition, then auto-continues agent turns until a fresh side-channel evaluator confirms the condition is met (guarded by a turn/token ceiling that pauses).

**Architecture:** All decision logic lives in a pure, pi-free `GoalController` plus pure helper functions (verdict parsing, directive/context building, command parsing, persistence) — mirroring the existing `SpecEngine` pattern. A thin wiring layer (`loop.ts` + `command.ts`) injects side effects (`sendUserMessage`, `completeSimple`, `notify`) so the core is unit-testable without a running pi. The evaluator is a **side-channel `completeSimple` call** — no agent turn, no re-entrancy.

**Tech Stack:** TypeScript, vitest, `@earendil-works/pi-coding-agent` (ExtensionAPI), `@earendil-works/pi-ai` (`completeSimple`).

Full context: `docs/plans/2026-07-01-goal-command-design.md`.

**Conventions:**
- Run a single test file: `npx vitest run tests/goal/<file>.test.ts`
- Run one test: `npx vitest run tests/goal/<file>.test.ts -t "<name>"`
- Typecheck: `npm run typecheck` · Lint: `npm run lint`
- Reference @superpowers:test-driven-development for the red-green-refactor loop.

---

### Task 1: Types + settings defaults

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

Run: `npx vitest run tests/goal/types.test.ts`
Expected: FAIL — cannot find module `src/goal/types`.

**Step 3: Write minimal implementation**

```ts
// src/goal/types.ts
export interface GoalSettings {
  maxTurns: number;      // pause on hit; 0 = unlimited
  maxTokens: number;     // pause on hit; 0 = off
  checkpointEvery: number; // pause every N turns; 0 = off
  evaluatorRole: string; // model-routing role for the evaluator
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
  tokensAtStart: number;
  tokensNow: number;
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

Run: `npx vitest run tests/goal/types.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/goal/types.ts tests/goal/types.test.ts
git commit -m "feat(goal): types + settings defaults"
```

---

### Task 2: Verdict parsing (fail-safe)

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

**Step 2: Run** `npx vitest run tests/goal/verdict.test.ts` → FAIL (no module).

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

**Step 5: Commit** `feat(goal): fail-safe verdict parsing`

---

### Task 3: Directive + evaluator-context builders

**Files:**
- Create: `src/goal/prompts.ts`
- Test: `tests/goal/prompts.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildDirective, buildEvaluatorContext, EVALUATOR_SYSTEM } from "../../src/goal/prompts";

describe("buildDirective", () => {
  it("includes condition, reason, and an evidence nudge", () => {
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
    const body = (ctx.messages[0].content as string);
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

export const EVALUATOR_SYSTEM = [
  "You are a fresh completion checker. You did NOT do the work.",
  "Decide ONLY from the evidence surfaced below whether the condition is met.",
  "You cannot run tools; if the evidence does not prove the condition, it is NOT met.",
  "Reply in exactly this format and nothing else:",
  "VERDICT: MET|NOT_MET",
  "REASON: <one short line>",
].join("\n");

export function buildDirective(condition: string, reason: string): string {
  return [
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
  return { systemPrompt: EVALUATOR_SYSTEM, messages: [{ role: "user", content: body }] };
}
```

> Note: confirm `Message`/`Context` shape against `@earendil-works/pi-ai` `types.d.ts` (`Context = { systemPrompt?, messages: Message[], tools? }`). Adjust the `messages[0]` literal if `Message.content` requires a `TextContent[]` rather than a string.

**Step 4: Run** → PASS. Then `npm run typecheck`.

**Step 5: Commit** `feat(goal): directive + evaluator context builders`

---

### Task 4: Command parsing (verbs + aliases)

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

**Step 5: Commit** `feat(goal): command verb + alias parsing`

---

### Task 5: GoalController — set/clear/status/validation

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
    const r = c.set("   ", 0);
    expect(r.ok).toBe(false);
  });
  it("rejects >4000 chars", () => {
    const c = new GoalController({}, now);
    expect(c.set("x".repeat(4001), 0).ok).toBe(false);
  });
  it("sets an active goal and returns the first directive = the condition", () => {
    const c = new GoalController({}, now);
    const r = c.set("all tests pass", 500);
    expect(r).toMatchObject({ ok: true, replaced: false, firstDirective: "all tests pass" });
    expect(c.snapshot()).toMatchObject({ condition: "all tests pass", status: "active", turnsEvaluated: 0, tokensAtStart: 500 });
  });
  it("replacing an active goal reports replaced:true", () => {
    const c = new GoalController({}, now);
    c.set("a", 0);
    expect(c.set("b", 0)).toMatchObject({ ok: true, replaced: true });
    expect(c.snapshot()?.condition).toBe("b");
  });
  it("clear removes the goal", () => {
    const c = new GoalController({}, now);
    c.set("a", 0); c.clear();
    expect(c.snapshot()).toBeUndefined();
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement (partial controller — extend in Task 6/7)**

```ts
// src/goal/controller.ts
import { resolveGoalSettings, type GoalSettings, type GoalSnapshot, type LoopAction, type Verdict } from "./types";
import { buildDirective } from "./prompts";

const MAX_CONDITION = 4000;

interface Internal {
  condition: string;
  status: "active" | "paused" | "achieved";
  startedAt: number;
  turnsEvaluated: number;
  tokensAtStart: number;
  tokensNow: number;
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
    return { ...this.g };
  }

  set(condition: string, tokensNow: number): SetResult {
    const trimmed = condition.trim();
    if (trimmed === "") return { ok: false, error: "Goal condition is empty." };
    if (trimmed.length > MAX_CONDITION) return { ok: false, error: `Condition exceeds ${MAX_CONDITION} characters.` };
    const replaced = this.g !== undefined && this.g.status !== "achieved";
    this.g = {
      condition: trimmed, status: "active", startedAt: this.now(),
      turnsEvaluated: 0, tokensAtStart: tokensNow, tokensNow,
    };
    return { ok: true, replaced, firstDirective: trimmed };
  }

  clear(): void { this.g = undefined; }
}
```

**Step 4: Run** → PASS. `npm run typecheck`.

**Step 5: Commit** `feat(goal): controller set/clear/validation`

---

### Task 6: GoalController — pause/resume

**Files:**
- Modify: `src/goal/controller.ts`
- Test: `tests/goal/controller.pause.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { GoalController } from "../../src/goal/controller";

describe("GoalController pause/resume", () => {
  it("pause moves active→paused and returns true", () => {
    const c = new GoalController();
    c.set("a", 0);
    expect(c.pause()).toBe(true);
    expect(c.snapshot()?.status).toBe("paused");
  });
  it("pause when not active returns false", () => {
    const c = new GoalController();
    expect(c.pause()).toBe(false);
  });
  it("resume moves paused→active and returns true", () => {
    const c = new GoalController();
    c.set("a", 0); c.pause();
    expect(c.resume()).toBe(true);
    expect(c.snapshot()?.status).toBe("active");
  });
  it("resume when not paused returns false", () => {
    const c = new GoalController();
    c.set("a", 0);
    expect(c.resume()).toBe(false);
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement (add to controller)**

```ts
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
```

**Step 4: Run** → PASS.

**Step 5: Commit** `feat(goal): controller pause/resume`

---

### Task 7: GoalController — onTurnResult (the loop core)

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
    const action = c.onTurnResult(met, 10);
    expect(action).toEqual({ kind: "achieved", reason: "done", turns: 1 });
    expect(c.snapshot()?.status).toBe("achieved");
  });

  it("NOT_MET with budget left → continue with directive containing the reason", () => {
    const c = new GoalController({ maxTurns: 25 }); c.set("cond", 0);
    const action = c.onTurnResult(notMet, 5);
    expect(action.kind).toBe("continue");
    if (action.kind === "continue") expect(action.directive).toContain("still failing");
    expect(c.snapshot()?.turnsEvaluated).toBe(1);
    expect(c.snapshot()?.lastReason).toBe("still failing");
  });

  it("hitting maxTurns → paused (ceiling-turns), not cleared", () => {
    const c = new GoalController({ maxTurns: 2 }); c.set("cond", 0);
    expect(c.onTurnResult(notMet, 0).kind).toBe("continue"); // turn 1
    const action = c.onTurnResult(notMet, 0);                 // turn 2 == ceiling
    expect(action).toMatchObject({ kind: "paused", why: "ceiling-turns" });
    expect(c.snapshot()?.status).toBe("paused");
  });

  it("hitting maxTokens delta → paused (ceiling-tokens)", () => {
    const c = new GoalController({ maxTurns: 0, maxTokens: 100 }); c.set("cond", 1000);
    const action = c.onTurnResult(notMet, 1100);
    expect(action).toMatchObject({ kind: "paused", why: "ceiling-tokens" });
  });

  it("checkpointEvery N → paused (checkpoint) on the Nth turn", () => {
    const c = new GoalController({ maxTurns: 0, checkpointEvery: 2 }); c.set("cond", 0);
    expect(c.onTurnResult(notMet, 0).kind).toBe("continue"); // 1
    expect(c.onTurnResult(notMet, 0)).toMatchObject({ kind: "paused", why: "checkpoint" }); // 2
  });

  it("paused goal ignores turn results → noop", () => {
    const c = new GoalController(); c.set("a", 0); c.pause();
    expect(c.onTurnResult(notMet, 0)).toEqual({ kind: "noop" });
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement (add to controller)**

```ts
  onTurnResult(verdict: Verdict, tokensNow: number): LoopAction {
    if (!this.g || this.g.status !== "active") return { kind: "noop" };
    this.g.tokensNow = tokensNow;
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
    if (maxTokens > 0 && tokensNow - this.g.tokensAtStart >= maxTokens) {
      this.g.status = "paused";
      return { kind: "paused", why: "ceiling-tokens", detail: `Reached ${maxTokens}-token ceiling.` };
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

**Step 4: Run** → PASS. `npm run typecheck`.

**Step 5: Commit** `feat(goal): controller loop core (onTurnResult + onError)`

---

### Task 8: Persistence (serialize / restore across --resume)

**Files:**
- Create: `src/goal/persist.ts`
- Test: `tests/goal/persist.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { GoalController } from "../../src/goal/controller";
import { serializeGoal, restoreController } from "../../src/goal/persist";

describe("goal persistence", () => {
  it("serializes only an active goal's condition", () => {
    const c = new GoalController(); c.set("cond", 500);
    expect(serializeGoal(c)).toEqual({ condition: "cond" });
  });
  it("does not serialize achieved/cleared goals", () => {
    const c = new GoalController(); c.set("cond", 0); c.onTurnResult({ met: true, reason: "x" }, 0);
    expect(serializeGoal(c)).toBeUndefined();
  });
  it("restore rebuilds an active goal with reset baselines", () => {
    const c = restoreController({ condition: "cond" }, { maxTurns: 25 }, () => 42, 900);
    expect(c.snapshot()).toMatchObject({ condition: "cond", status: "active", turnsEvaluated: 0, startedAt: 42, tokensAtStart: 900 });
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement**

```ts
// src/goal/persist.ts
import { GoalController } from "./controller";
import type { GoalSettings } from "./types";

export interface GoalPersistPayload { condition: string }

export function serializeGoal(c: GoalController): GoalPersistPayload | undefined {
  const s = c.snapshot();
  if (!s || s.status === "achieved") return undefined;
  return { condition: s.condition };
}

export function restoreController(
  payload: GoalPersistPayload,
  settings: Partial<GoalSettings> | undefined,
  now: () => number,
  tokensNow: number,
): GoalController {
  const c = new GoalController(settings, now);
  c.set(payload.condition, tokensNow); // resets turns/timer/token baseline by design
  return c;
}
```

> Serialize also for a `paused` goal (so a paused goal survives resume as active — matches "restore active goal"; acceptable simplification). If you want paused to stay paused, extend the payload with `status` and have `restoreController` call `pause()`.

**Step 4: Run** → PASS.

**Step 5: Commit** `feat(goal): active-goal persistence for --resume`

---

### Task 9: Loop handler (thin, injected side-effects)

**Files:**
- Create: `src/goal/loop.ts`
- Test: `tests/goal/loop.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { GoalController } from "../../src/goal/controller";
import { handleAgentEnd } from "../../src/goal/loop";

function deps(overrides = {}) {
  return {
    controller: new GoalController({ maxTurns: 25 }),
    runEvaluator: vi.fn(async () => ({ met: false, reason: "still failing" })),
    sendDirective: vi.fn(async (_d: string) => {}),
    notify: vi.fn((_m: string, _l?: string) => {}),
    getTokens: () => 100,
    isSubagent: false,
    ...overrides,
  };
}

describe("handleAgentEnd", () => {
  it("does nothing inside a subagent", async () => {
    const d = deps({ isSubagent: true }); d.controller.set("a", 0);
    await handleAgentEnd(d as any, { willRetry: false, lastAssistantText: "", toolResultsText: "" });
    expect(d.runEvaluator).not.toHaveBeenCalled();
  });

  it("skips when willRetry is true", async () => {
    const d = deps(); d.controller.set("a", 0);
    await handleAgentEnd(d as any, { willRetry: true, lastAssistantText: "", toolResultsText: "" });
    expect(d.runEvaluator).not.toHaveBeenCalled();
  });

  it("NOT_MET → sends the continuation directive", async () => {
    const d = deps(); d.controller.set("cond", 0);
    await handleAgentEnd(d as any, { willRetry: false, lastAssistantText: "x", toolResultsText: "y" });
    expect(d.sendDirective).toHaveBeenCalledTimes(1);
    expect(d.sendDirective.mock.calls[0][0]).toContain("still failing");
  });

  it("MET → notifies achievement, no further directive", async () => {
    const d = deps({ runEvaluator: vi.fn(async () => ({ met: true, reason: "done" })) });
    d.controller.set("cond", 0);
    await handleAgentEnd(d as any, { willRetry: false, lastAssistantText: "", toolResultsText: "" });
    expect(d.sendDirective).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalled();
  });

  it("evaluator throwing twice → pauses (eval-error), no directive", async () => {
    const runEvaluator = vi.fn(async () => { throw new Error("boom"); });
    const d = deps({ runEvaluator }); d.controller.set("cond", 0);
    await handleAgentEnd(d as any, { willRetry: false, lastAssistantText: "", toolResultsText: "" });
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

export interface LoopDeps {
  controller: GoalController;
  runEvaluator: (lastAssistantText: string, toolResultsText: string, previousReason?: string) => Promise<Verdict>;
  sendDirective: (directive: string) => Promise<void>;
  notify: (message: string, level?: "info" | "warning") => void;
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
      if (action.kind === "paused") deps.notify(`◎ /goal paused — ${action.detail} Run /goal resume to continue.`, "warning");
      return;
    }
  }

  const action = controller.onTurnResult(verdict, deps.getTokens());
  switch (action.kind) {
    case "continue": await deps.sendDirective(action.directive); break;
    case "achieved": deps.notify(`◎ /goal achieved in ${action.turns} turns — ${action.reason}`); break;
    case "paused": deps.notify(`◎ /goal paused — ${action.detail} Run /goal resume to continue.`, "warning"); break;
    case "noop": break;
  }
}
```

**Step 4: Run** → PASS. `npm run typecheck`.

**Step 5: Commit** `feat(goal): agent_end loop handler`

---

### Task 10: Command registration + index wiring (manual verification)

**Files:**
- Create: `src/goal/command.ts` — `registerGoalCommand(pi, opts)`.
- Modify: `src/index.ts` — call `registerGoalCommand(...)` near `registerSlashCommands` (~line 1096); register `pi.on("agent_end", ...)` that builds `LoopDeps` and calls `handleAgentEnd`; on `session_start`, read the persisted payload and `restoreController`; on `session_shutdown`/before-compact, persist via `appendEntry`.

This task is wiring against the live ExtensionAPI, so it is verified by running the app rather than unit tests. Build the pieces incrementally:

**Step 1:** Implement `registerGoalCommand` using `pi.registerCommand("goal", { description, getArgumentCompletions, handler })`. In the handler, call `parseGoalCommand(args)` and dispatch:
- `set` → `controller.set(...)`; on `ok` notify `◎ /goal active`, emit the not-in-auto-mode hint once, then `pi.sendUserMessage(firstDirective, { deliverAs: "followUp" })`; on `!ok` notify the error.
- `status` → render `formatPanel` from `controller.snapshot()` (condition, elapsed = `now - startedAt`, turns, `tokensNow - tokensAtStart`, `lastReason`); if none active but `achieved` present, show the achieved entry.
- `clear`/`pause`/`resume` → call controller + notify.
- Guard `isSubagent` (main-session only) and `ctx.isProjectTrusted()` (refuse with reason when untrusted) up front.

**Step 2:** In `src/index.ts`, construct a single shared `GoalController` (from settings `goal`) and register:

```ts
pi.on("agent_end", async (event, ctx) => {
  const last = event.messages[event.messages.length - 1];
  await handleAgentEnd({
    controller,
    runEvaluator: (a, t, prev) => runEvaluatorCall(ctx, settings.goal, { condition: controller.snapshot()!.condition, lastAssistantText: a, toolResultsText: t, previousReason: prev }),
    sendDirective: (d) => pi.sendUserMessage(d, { deliverAs: "followUp" }),
    notify: (m, l) => ctx.ui.notify(m, l ?? "info"),
    getTokens: () => ctx.getContextUsage()?.tokens ?? 0,
    isSubagent,
  }, {
    willRetry: (event as any).willRetry ?? false,
    lastAssistantText: extractText(last),
    toolResultsText: "", // fill from the turn's tool results if surfaced on the event
  });
});
```

**Step 3:** Implement `runEvaluatorCall` in `src/goal/evaluator.ts`: resolve the evaluator model (model-routing `evaluatorRole` override → model registry; else `ctx.getModel()`), `buildEvaluatorContext(...)`, call `completeSimple(model, context, { reasoning: "low" })`, extract text, `parseVerdict(text)`. Add a light unit test with `completeSimple` mocked if practical; otherwise verify live.

**Step 4:** Verify live. Use @verify / the `run` skill:
- `/goal echo the word DONE in your reply` → agent replies DONE → evaluator MET → auto-clears with the achievement notice.
- `/goal` → shows status while active. `/goal pause` / `/goal resume` / `/goal clear` behave.
- Set `goal.maxTurns: 1` and give an unsatisfiable condition → after one turn it pauses with `ceiling-turns`.
- Confirm no loop runs inside a spawned subagent.

**Step 5: Commit**

```bash
git add src/goal/command.ts src/goal/evaluator.ts src/index.ts
git commit -m "feat(goal): register /goal command + agent_end wiring"
```

---

### Task 11: Docs + settings example

**Files:**
- Modify: `agent/settings.example.json` — add the `goal` block with the approved defaults + comments.
- Modify: `README.md` — add a `/goal` section (what it does, commands, the `goal` settings, the guarded-loop/pause behavior).

**Step 1:** Add settings + README section. **Step 2:** `npm run lint && npm run typecheck && npx vitest run tests/goal`. **Step 3:** Commit `docs(goal): document /goal command + settings`.

---

## Final verification

Run: `npx vitest run tests/goal && npm run typecheck && npm run lint`
Expected: all green. Then the live checks from Task 10 Step 4.

## Notes for the implementer
- The pure modules (Tasks 1–9) are the contract; the wiring (Task 10) adapts pi's real event/field names — confirm `agent_end` exposes `willRetry` and how tool-result text is surfaced; adjust `AgentEndInfo` extraction accordingly.
- Keep the evaluator **tool-less** and **last-turn-scoped** — do not send full history.
- Fail-safe everywhere: unknown/parse/eval failures must never declare a false "achieved".
