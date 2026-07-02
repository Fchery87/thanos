# Fable-Class Harness Roadmap — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use @superpowers:executing-plans to implement this plan task-by-task. Each milestone is independently shippable; do them in order (M0 → M7). Run in a dedicated worktree (`thanos/harness-roadmap`). Use @superpowers:test-driven-development for every code task.

**Goal:** Strengthen the Thanos harness so that *any* configured model produces Fable-5-class output, by imposing the 2026 frontier loop — non-bypassable verification, heterogeneous critique, and a reasoning sandwich — on top of the existing spec/subagent architecture.

**Architecture:** Eight milestones, ordered by quality-per-effort. M0 upgrades the current keyword-level spec into a default-fail contract plus fresh-context evaluator. M1 turns advisory spec verification into a non-bypassable completion gate using the proven `pi.sendUserMessage(..., {deliverAs:"followUp"})` continuation primitive. M2 evolves `/review` from a single reviewer into a parallel heterogeneous jury + always-on devil's advocate. M3 is pure config: per-role model + thinking routing (the "reasoning sandwich"). M4 makes delivery gates run per-iteration with a security scanner. M5 adds a stateless outer-loop ledger. M6 adds bounded wave orchestration for parallel research/analysis and isolated writer worktrees. M7 closes the outer loop with trace-driven harness evolution. No new runtime dependencies unless a later milestone explicitly justifies one; everything starts from `src/spec/`, `src/index.ts` event hooks, the `pi-subagents` engine, and `agent/settings.json`.

**Tech Stack:** TypeScript (ESM), Pi extension API (`@earendil-works/pi-coding-agent` 0.80.2), `pi-subagents`, Vitest, Bun. Agents are markdown in `agent/agents/*.md`; routing lives in `agent/settings.json`.

**Key grounding facts (verified against the live tree):**
- `SpecEngine` (`src/spec/engine.ts`) already produces a `FormalSpec` with acceptance criteria, collects `EvidenceRecord`s, and exposes `verify(): VerificationResult[]`.
- `src/spec/generator.ts` currently builds acceptance criteria from simple keywords (`add`, `test`, `refactor`). That is not enough for Fable-class output; M0 upgrades this into an explicit contract/evaluator loop before M1 makes completion non-bypassable.
- `pi.on("agent_end")` (`src/index.ts:1449`) already calls `spec.finishTurn()` and renders a panel — **but never blocks or re-injects.** This is the lever.
- `pi.sendUserMessage(content, { deliverAs: "followUp" })` is already used at `src/index.ts:1229` (`/review`) and `:1252` (`/designer`) and "always triggers a turn." This is the continuation primitive.
- `before_agent_start` (`src/index.ts:1331`) calls `spec.startTurn(event.prompt, …)` which **resets the spec every turn**. A naive re-injection would wipe the original spec/evidence — M1 Task 5 handles this trap explicitly.
- Valid spec evidence requirements are `diff`, `test`, `command`, and `manual` (`src/spec/types.ts`). Do not invent a `bash` evidence type; bash test commands record `test`, while other bash commands record `command`.
- `gateDisabledByEnv` should mirror the existing zero-argument `yoloDisabledByEnv()` style in `src/permissions/yolo-config.ts`; read from `process.env` inside the helper instead of threading an env object through `src/index.ts`.
- `.thanos/delivery.json` is already part of the delivery resolver (`src/governance/delivery.ts`), and `build.md` already treats its gates as definition of done. M4 should add concrete gates and tighten agent behavior, not introduce the delivery-file mechanism from scratch.
- `worker.md` and `scout.md` already declare `defaultProgress: true`; M5 should standardize the ledger schema and read/write rules rather than pretending progress tracking is absent.
- External harness patterns this roadmap deliberately adopts: default-fail criteria, fresh-context evaluator, bounded waves, multi-model synthesis for high-stakes decisions, execution-grounded verification, and trace-driven harness improvement.
- Tests live in `tests/spec/*.test.ts`, style: `import { describe, expect, it } from "vitest"`, import source as `../../src/...`.
- Run a single test: `bunx vitest run tests/spec/<file>.test.ts`. Full gate: `bun run ci` (typecheck + lint + test).

---

## Milestone 0 — Default-Fail Contract + Fresh-Context Evaluator

**Outcome:** The harness no longer asks a model to decide what "done" means after it has already built the thing. Every non-instant task starts from an explicit, evidence-backed contract whose criteria are false until proven, and a separate read-only evaluator can grade the result from a fresh context. This is the loss function that makes M1's completion gate meaningful.

**Why this is top priority:** M1 can only enforce the quality of the criteria it receives. The current keyword generator is too shallow for the goal of Fable-5-class output from arbitrary models. External high-performing harnesses converge on "criteria before code" and generation/evaluation separation; this milestone ports that pattern into Thanos.

### Task 1: Add a contract builder for richer default-fail criteria

**Files:**
- Create: `src/spec/contract.ts`
- Modify: `src/spec/generator.ts`
- Test: `tests/spec/contract.test.ts`
- Test: `tests/spec/engine.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { buildDefaultFailContract } from "../../src/spec/contract";

describe("buildDefaultFailContract", () => {
  it("turns implementation prompts into evidence-backed criteria", () => {
    const contract = buildDefaultFailContract("Add pagination with tests and update docs");
    expect(contract.acceptanceCriteria.map((c) => c.statement)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/code change/i),
        expect.stringMatching(/tests|verification/i),
        expect.stringMatching(/documentation/i),
      ]),
    );
    expect(contract.acceptanceCriteria.every((c) => c.evidenceRequired.length > 0)).toBe(true);
    expect(contract.acceptanceCriteria.some((c) => c.evidenceRequired.includes("test"))).toBe(true);
    expect(contract.acceptanceCriteria.some((c) => c.evidenceRequired.includes("diff"))).toBe(true);
  });

  it("keeps criteria default-fail by requiring concrete evidence", () => {
    const contract = buildDefaultFailContract("Refactor auth module and verify behavior");
    expect(contract.acceptanceCriteria).not.toHaveLength(0);
    expect(contract.acceptanceCriteria.every((c) => c.evidenceRequired.length > 0)).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/spec/contract.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the contract builder**

Create `src/spec/contract.ts` as a pure module. Keep it deterministic for now; do not add an LLM dependency. Use the prompt to produce a conservative contract:

```typescript
import type { AcceptanceCriterion } from "./types";

export interface DefaultFailContract {
  acceptanceCriteria: AcceptanceCriterion[];
  notes: string[];
}

export function buildDefaultFailContract(prompt: string): DefaultFailContract {
  const lower = prompt.toLowerCase();
  const criteria: AcceptanceCriterion[] = [];

  if (/\b(add|build|create|implement|update|remove|migrate)\b/.test(lower)) {
    criteria.push({
      id: "contract-diff",
      statement: "Requested code change is implemented in the relevant files",
      evidenceRequired: ["diff"],
    });
  }
  if (/\b(test|verify|regression|coverage)\b/.test(lower)) {
    criteria.push({
      id: "contract-tests",
      statement: "Relevant tests or verification commands pass",
      evidenceRequired: ["test"],
    });
  }
  if (/\bdoc|readme|adr|plan\b/.test(lower)) {
    criteria.push({
      id: "contract-docs",
      statement: "Requested documentation is updated",
      evidenceRequired: ["diff"],
    });
  }
  if (/\brefactor|cleanup|deslop\b/.test(lower)) {
    criteria.push({
      id: "contract-refactor",
      statement: "Behavior is preserved while the code structure is improved",
      evidenceRequired: ["diff", "command"],
    });
  }
  if (criteria.length === 0) {
    criteria.push({
      id: "contract-manual",
      statement: "Task outcome is explicitly demonstrated",
      evidenceRequired: ["manual"],
    });
  }

  return { acceptanceCriteria: criteria, notes: ["Criteria are default-fail until matching evidence is collected."] };
}
```

Then make `src/spec/generator.ts` call `buildDefaultFailContract()` instead of its current keyword-only `buildCriteria()` body. Preserve existing `FormalSpec` fields and current tests where possible.

**Step 4: Run the focused tests**

Run: `bunx vitest run tests/spec/contract.test.ts tests/spec/engine.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/spec/contract.ts src/spec/generator.ts tests/spec/contract.test.ts tests/spec/engine.test.ts
git commit -m "feat(spec): derive default-fail evidence contracts"
```

### Task 2: Add a fresh-context evaluator agent

**Files:**
- Create: `agent/agents/evaluator.md`
- Modify: `src/agents/registry.ts`
- Test: `tests/agents/registry.test.ts`
- Test: `tests/agents/loader.test.ts`

**Step 1: Write the failing tests**

Add assertions that `evaluator` is a registered agent type and loads successfully.

Run: `bunx vitest run tests/agents/registry.test.ts tests/agents/loader.test.ts -t "evaluator"`
Expected: FAIL — evaluator is not registered / file missing.

**Step 2: Create `agent/agents/evaluator.md`**

Use a read-only, fresh-context evaluator prompt:

```markdown
---
name: evaluator
description: Fresh-context evaluator that grades implementation evidence against the active contract. Read-only; never edits.
tools: read, ls, find, grep, bash, report_finding
maxTurns: 24
maxExecutionTimeMs: 900000
---
You are Evaluator. You did not build the change. Your job is to grade the result against the contract and evidence, not against the builder's claims.

Rules:
- Treat every criterion as FAIL until you open evidence that proves it.
- Prefer command/test output, diffs, screenshots, and artifacts over summaries.
- Do not edit files.
- Do not invent missing evidence.
- Return PASS only when every criterion is satisfied.

Output:
Return the Subagent Result Contract. Put `PASS` or `NEEDS_WORK` first in `summary`, then list each criterion with pass/fail and evidence path/command.
```

**Step 3: Register the agent**

Update `src/agents/registry.ts` to include `evaluator` in `AGENT_TYPES` and ensure it is read-only under existing policy narrowing.

**Step 4: Run the tests**

Run: `bunx vitest run tests/agents/registry.test.ts tests/agents/loader.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add agent/agents/evaluator.md src/agents/registry.ts tests/agents/registry.test.ts tests/agents/loader.test.ts
git commit -m "feat(agents): add fresh-context evaluator"
```

### Task 3: Add an evaluator dispatch prompt for high-risk or explicit contracts

**Files:**
- Create: `src/spec/evaluator.ts`
- Test: `tests/spec/evaluator.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { buildEvaluatorPrompt } from "../../src/spec/evaluator";

describe("buildEvaluatorPrompt", () => {
  it("asks the evaluator to grade evidence against criteria from a fresh context", () => {
    const prompt = buildEvaluatorPrompt({
      goal: "Add pagination",
      criteria: [{ id: "c1", statement: "Tests pass", evidenceRequired: ["test"] }],
    });

    expect(prompt).toContain("evaluator");
    expect(prompt).toContain("fresh context");
    expect(prompt).toContain("Tests pass");
    expect(prompt).toMatch(/PASS|NEEDS_WORK/);
  });
});
```

**Step 2: Run it to verify it fails**

Run: `bunx vitest run tests/spec/evaluator.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `buildEvaluatorPrompt()`**

The prompt should instruct the main agent to use the `subagent` tool to run `evaluator`, pass the goal and criteria, and require a PASS/NEEDS_WORK verdict. Keep it pure and string-based so `/review`, `/ship`, or M1 can reuse it later.

**Step 4: Run the test**

Run: `bunx vitest run tests/spec/evaluator.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/spec/evaluator.ts tests/spec/evaluator.test.ts
git commit -m "feat(spec): build fresh-context evaluator prompt"
```

## Milestone 1 — Completion Verification Gate (the agent never self-certifies)

**Outcome:** When an ambient/explicit spec has unmet acceptance criteria at `agent_end`, the harness re-injects the failing criteria as a follow-up turn instead of letting the agent stop — bounded by a retry budget, parent-session only, and env-disengageable. Turns the LangChain "PreCompletionChecklist / Ralph-Wiggum" pattern into a Thanos primitive.

### Task 1: Add a bounded gate-attempt counter to `SpecEngine`

**Files:**
- Modify: `src/spec/engine.ts`
- Test: `tests/spec/engine.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/spec/engine.test.ts — add inside the existing describe block
it("tracks gate attempts and resets them on a new turn", () => {
  const spec = new SpecEngine();
  spec.startTurn("Implement a new feature for the billing flow", false);
  expect(spec.gateAttempts).toBe(0);
  spec.recordGateAttempt();
  spec.recordGateAttempt();
  expect(spec.gateAttempts).toBe(2);
  spec.startTurn("Implement a new feature for the billing flow", false);
  expect(spec.gateAttempts).toBe(0); // reset on fresh turn
});
```

**Step 2: Run it to verify it fails**

Run: `bunx vitest run tests/spec/engine.test.ts -t "tracks gate attempts"`
Expected: FAIL — `spec.gateAttempts is not a function`/undefined.

**Step 3: Implement the minimal code**

In `src/spec/engine.ts`, add the field and method, and reset it in `reset()`:

```typescript
export class SpecEngine {
  activeSpec: FormalSpec | undefined;
  gateAttempts = 0;
  private evidence: EvidenceRecord[] = [];

  // ...existing methods...

  recordGateAttempt(): void {
    this.gateAttempts += 1;
  }

  reset(): void {
    this.activeSpec = undefined;
    this.evidence = [];
    this.gateAttempts = 0;
  }
}
```

**Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/spec/engine.test.ts`
Expected: PASS (all existing + new).

**Step 5: Commit**

```bash
git add src/spec/engine.ts tests/spec/engine.test.ts
git commit -m "feat(spec): track bounded gate-attempt counter on SpecEngine"
```

### Task 2: Pure module — decide whether to re-inject

**Files:**
- Create: `src/spec/gate.ts`
- Test: `tests/spec/gate.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { shouldReinject, GATE_MAX_ATTEMPTS } from "../../src/spec/gate";
import type { VerificationResult } from "../../src/spec/verification";

const crit = (passed: boolean): VerificationResult => ({
  criterion: { id: "c1", statement: "tests pass", evidenceRequired: ["test"] },
  passed,
  evidence: [],
});

describe("shouldReinject", () => {
  it("re-injects when a criterion fails and budget remains", () => {
    expect(shouldReinject({ results: [crit(false)], attempts: 0, isSubagent: false, enabled: true })).toBe(true);
  });
  it("does not re-inject when all criteria pass", () => {
    expect(shouldReinject({ results: [crit(true)], attempts: 0, isSubagent: false, enabled: true })).toBe(false);
  });
  it("does not re-inject in a subagent", () => {
    expect(shouldReinject({ results: [crit(false)], attempts: 0, isSubagent: true, enabled: true })).toBe(false);
  });
  it("stops once the attempt budget is exhausted", () => {
    expect(shouldReinject({ results: [crit(false)], attempts: GATE_MAX_ATTEMPTS, isSubagent: false, enabled: true })).toBe(false);
  });
  it("is a no-op when disabled", () => {
    expect(shouldReinject({ results: [crit(false)], attempts: 0, isSubagent: false, enabled: false })).toBe(false);
  });
  it("does not re-inject with no results (instant tier / no spec)", () => {
    expect(shouldReinject({ results: [], attempts: 0, isSubagent: false, enabled: true })).toBe(false);
  });
});
```

**Step 2: Run it to verify it fails**

Run: `bunx vitest run tests/spec/gate.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the minimal code**

```typescript
// src/spec/gate.ts
import type { VerificationResult } from "./verification";

export const GATE_MAX_ATTEMPTS = 3;
export const GATE_CONTINUE_SENTINEL = "[harness:verify-continue]";

export interface ReinjectInputs {
  results: VerificationResult[];
  attempts: number;
  isSubagent: boolean;
  enabled: boolean;
}

export function shouldReinject(input: ReinjectInputs): boolean {
  if (!input.enabled) return false;
  if (input.isSubagent) return false;
  if (input.results.length === 0) return false;
  if (input.attempts >= GATE_MAX_ATTEMPTS) return false;
  return input.results.some((r) => !r.passed);
}
```

**Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/spec/gate.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/spec/gate.ts tests/spec/gate.test.ts
git commit -m "feat(spec): pure shouldReinject decision for the verification gate"
```

### Task 3: Pure module — render the continuation prompt

**Files:**
- Modify: `src/spec/gate.ts`
- Test: `tests/spec/gate.test.ts`

**Step 1: Write the failing test**

```typescript
import { buildContinuationPrompt } from "../../src/spec/gate";
// ...inside describe("buildContinuationPrompt")...
it("lists only the unmet criteria and carries the sentinel", () => {
  const prompt = buildContinuationPrompt([crit(false), crit(true)], 1);
  expect(prompt).toContain("[harness:verify-continue]");
  expect(prompt).toContain("tests pass");
  expect(prompt).toContain("attempt 2"); // attempts+1 shown to the agent
  expect(prompt.toLowerCase()).toContain("do not stop");
});
```

**Step 2: Run it to verify it fails**

Run: `bunx vitest run tests/spec/gate.test.ts -t "buildContinuationPrompt"`
Expected: FAIL — not exported.

**Step 3: Implement**

```typescript
// append to src/spec/gate.ts
export function buildContinuationPrompt(results: VerificationResult[], attempts: number): string {
  const unmet = results.filter((r) => !r.passed).map((r) => `- ${r.criterion.statement} (needs evidence: ${r.criterion.evidenceRequired.join(", ") || "—"})`);
  return [
    `${GATE_CONTINUE_SENTINEL} The task is not done — acceptance criteria are unverified (verification attempt ${attempts + 1} of ${GATE_MAX_ATTEMPTS}).`,
    "",
    "Unmet criteria:",
    ...unmet,
    "",
    "Do NOT stop or summarize as complete. Produce the missing evidence: run the tests/build/lint or take the action each criterion requires, then continue. If a criterion is genuinely unverifiable or wrong, say so explicitly and explain why rather than silently dropping it.",
  ].join("\n");
}
```

**Step 4: Run to verify it passes**

Run: `bunx vitest run tests/spec/gate.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/spec/gate.ts tests/spec/gate.test.ts
git commit -m "feat(spec): render verification-gate continuation prompt"
```

### Task 4: Env opt-out helper

**Files:**
- Modify: `src/permissions/yolo-config.ts`
- Test: `tests/permissions/yolo-config.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/permissions/yolo-config.test.ts
import { gateDisabledByEnv } from "../../src/permissions/yolo-config";

it("disables the verification gate when THANOS_VERIFY_GATE=off", () => {
  process.env.THANOS_VERIFY_GATE = " off ";
  expect(gateDisabledByEnv()).toBe(true);
});

it("keeps the verification gate enabled by default", () => {
  delete process.env.THANOS_VERIFY_GATE;
  expect(gateDisabledByEnv()).toBe(false);
});
```

Also update the existing `afterEach` in this file to delete `process.env.THANOS_VERIFY_GATE`.

**Step 2: Run it to verify it fails**

Run: `bunx vitest run tests/permissions/yolo-config.test.ts -t "verification gate"`
Expected: FAIL — `gateDisabledByEnv` is not exported.

**Step 3: Implement the helper, matching the current zero-argument env-helper style**

```typescript
export function gateDisabledByEnv(): boolean {
  return process.env.THANOS_VERIFY_GATE?.trim().toLowerCase() === "off";
}
```

**Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/permissions/yolo-config.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/permissions/yolo-config.ts tests/permissions/yolo-config.test.ts
git commit -m "feat(spec): add verification-gate env opt-out"
```

### Task 5: Wire the gate into `agent_end` (and protect the spec across the continuation turn)

**Files:**
- Modify: `src/index.ts` (the `pi.on("agent_end")` handler at ~`:1449`, and the `before_agent_start` handler at ~`:1331`)
- Test: `tests/index.test.ts`

**Step 1: Write the failing hook tests**

Add focused tests to `tests/index.test.ts` using the existing `createFakePi()` pattern:

First add a default no-op sender to the fake Pi so existing failed-verification tests do not crash once the gate is wired:

```typescript
sendUserMessage: vi.fn(async () => undefined),
```

```typescript
it("does not reset the active spec for a verification continuation turn", async () => {
  const { api, handlers } = createFakePi();
  register(api);

  const beforeAgentStart = handlers.get("before_agent_start");
  const agentEnd = handlers.get("agent_end");
  const notify = vi.fn();

  await beforeAgentStart?.({ prompt: "Add pagination with tests" }, {
    model: undefined,
    ui: { setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() },
  });
  await beforeAgentStart?.({ prompt: "[harness:verify-continue] keep going" }, {
    model: undefined,
    ui: { setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() },
  });
  await agentEnd?.({ messages: [] }, {
    hasUI: true,
    ui: { notify, setStatus: vi.fn(), theme: noopTheme },
  });

  expect(notify).toHaveBeenCalledWith(expect.stringContaining("Tests written"), "warning");
});

it("re-injects a follow-up when verification fails and the gate is enabled", async () => {
  const sendUserMessage = vi.fn(async () => undefined);
  const { api, handlers } = createFakePi({ sendUserMessage } as Partial<RegisterApi>);
  register(api);

  await handlers.get("before_agent_start")?.({ prompt: "Add pagination with tests" }, {
    model: undefined,
    ui: { setHeader: vi.fn(), setStatus: vi.fn(), notify: vi.fn() },
  });
  await handlers.get("agent_end")?.({ messages: [] }, {
    hasUI: true,
    ui: { notify: vi.fn(), setStatus: vi.fn(), theme: noopTheme },
  });

  expect(sendUserMessage).toHaveBeenCalledWith(
    expect.stringContaining("[harness:verify-continue]"),
    { deliverAs: "followUp" },
  );
});
```

If the fake Pi type does not include `sendUserMessage`, extend only the local test helper shape; do not loosen production types.

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/index.test.ts -t "verification"`
Expected: FAIL — continuation resets the spec and/or `sendUserMessage` is not called.

**Step 3: Guard `before_agent_start` so a continuation turn does NOT reset the spec**

This is the trap: the re-injected follow-up is a normal user message, so without a guard `spec.startTurn()` would regenerate a spec from the continuation text and lose the original criteria + evidence. In `before_agent_start`, detect the sentinel and skip the reset:

```typescript
// near the top of the before_agent_start handler, before spec.startTurn(...)
import { GATE_CONTINUE_SENTINEL } from "./spec/gate";
// ...
const isGateContinuation = event.prompt.startsWith(GATE_CONTINUE_SENTINEL);
if (!isGateContinuation) {
  spec.startTurn(event.prompt, pi.getFlag("spec") === true);
}
// leave lens.beginTurn()/memory injection as-is
```

**Step 4: Re-inject from `agent_end` when criteria are unmet**

Replace the body of the `agent_end` handler so that, after rendering the existing panel, it consults the gate and (if warranted) records an attempt and re-injects:

```typescript
import { shouldReinject, buildContinuationPrompt } from "./spec/gate";
import { gateDisabledByEnv } from "./permissions/yolo-config";

pi.on("agent_end", async (event, ctx: ExtensionContext) => {
  const results = spec.finishTurn(event.messages);
  if (results.length === 0) return;

  // ...existing panel/notify rendering stays here unchanged...

  const enabled = !gateDisabledByEnv();
  if (shouldReinject({ results, attempts: spec.gateAttempts, isSubagent, enabled })) {
    const prompt = buildContinuationPrompt(results, spec.gateAttempts);
    spec.recordGateAttempt();
    await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  }
});
```

**Step 5: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: clean. (`isSubagent` is already in scope in `register()`.)

**Step 6: Manual end-to-end verification**

Launch Pi in this repo, give an ambient implementation prompt whose criteria require a `bash` test-run, and have the agent try to stop *without* running anything. Expected: a follow-up turn appears carrying `[harness:verify-continue]` with the unmet criteria; after the agent runs the tests, the next `agent_end` shows the spec passing and no re-injection. Confirm it stops after at most `GATE_MAX_ATTEMPTS` re-injections even if criteria never pass (no infinite loop). Capture the transcript to `.harness/design/m1-gate-verification.txt` as evidence.

**Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat(harness): non-bypassable completion verification gate via re-injection"
```

### Task 6: Docs + ADR

**Files:**
- Create: `docs/adr/0006-completion-verification-gate.md`
- Modify: `README.md` (document `THANOS_VERIFY_GATE=off`)

**Step 1:** Write ADR 0006 in the repo's existing ADR format (Context / Decision / Consequences), referencing this plan and the LangChain/Gen-Alpha/Anthropic harness sources.
**Step 2:** Add a README subsection under the governance area describing the gate, the 3-attempt budget, and the `THANOS_VERIFY_GATE=off` escape hatch.
**Step 3:** `bun run ci` -> all green.
**Step 4:** Commit `docs(adr-0006): completion verification gate`.

---

## Milestone 2 — Heterogeneous Review Jury (mixture of critics + devil's advocate)

**Outcome:** `/review` fans out parallel, narrowly-scoped critics on *different model families*, an `oracle` devil's advocate that runs **even when reviewers find nothing**, and a synthesis pass that de-duplicates into one verdict. Compensates for any single model's blind spots — independent confirmation is the strongest signal.

### Task 1: Create focused critic agent definitions

**Files:**
- Create: `agent/agents/reviewer-correctness.md`
- Create: `agent/agents/reviewer-security.md`
- Create: `agent/agents/reviewer-tests.md`

Each mirrors the existing `agent/agents/reviewer.md` frontmatter (`tools: read, ls, find, grep, subagent, report_finding`, read-only) but narrows the persona to one concern and instructs it to return P0–P3 findings scoped to that concern only. Keep them short; the shared review discipline already lives in `reviewer.md` — reference it.

**Verification:** `grep -l "report_finding" agent/agents/reviewer-*.md` lists all three. Commit `feat(agents): focused correctness/security/tests critics`.

### Task 2: Extract the jury dispatch prompt into a pure, tested builder

**Files:**
- Create: `src/review/jury.ts`
- Test: `tests/review/jury.test.ts`

**Step 1: Failing test**

```typescript
import { describe, expect, it } from "vitest";
import { buildJuryPrompt } from "../../src/review/jury";

describe("buildJuryPrompt", () => {
  it("dispatches the critic panel in parallel plus an always-on devil's advocate", () => {
    const p = buildJuryPrompt();
    expect(p).toMatch(/parallel/i);
    expect(p).toContain("reviewer-correctness");
    expect(p).toContain("reviewer-security");
    expect(p).toContain("reviewer-tests");
    expect(p).toContain("oracle"); // devil's advocate
    expect(p.toLowerCase()).toContain("even if"); // DA runs even on zero findings
    expect(p.toLowerCase()).toContain("syntheS".toLowerCase()) ; // synthesis/dedupe step
  });
});
```

**Step 2:** Run `bunx vitest run tests/review/jury.test.ts` → FAIL.

**Step 3:** Implement `buildJuryPrompt()` returning a single instruction string that tells the main agent to: (a) use the `subagent` tool in **parallel** mode to run `reviewer-correctness`, `reviewer-security`, `reviewer-tests` on the session diff; (b) run `oracle` as a devil's advocate that challenges each finding (KEEP/WEAKEN/DROP) and raises gaps **even if the reviewers reported nothing**; (c) synthesize: de-duplicate, rank by severity, and emit one verdict (APPROVE / COMMENT / REQUEST_CHANGES). Keep the implementer/critic separation explicit ("you are the judge; do not write findings yourself").

**Step 4:** Run the test → PASS.

**Step 5:** Commit `feat(review): pure jury dispatch-prompt builder`.

### Task 3: Wire the jury into the `/review` shortcut

**Files:**
- Modify: `src/index.ts` (the `ctrl+shift+r` review shortcut at ~`:1218`)

Replace the inline single-reviewer string passed to `pi.sendUserMessage(...)` with `buildJuryPrompt()`. Keep `deliverAs: "followUp"` and the `isSubagent` guard. Typecheck + lint. Manual verify: trigger `/review` on a branch with a known bug and confirm parallel critics + oracle DA + a single synthesized verdict appear. Capture transcript to `.harness/design/m2-jury.txt`. Commit `feat(review): /review runs the heterogeneous jury`.

### Task 4: Route critics across model families (depends on M3 being available)

Add `agentOverrides` for `reviewer-correctness` / `reviewer-security` / `reviewer-tests` / `oracle` pinning each to a *different* family (see M3). This is what makes the jury heterogeneous. Verify with `/subagents-models`. Commit `chore(settings): heterogeneous model routing for the review jury`.

---

## Milestone 3 — Reasoning Sandwich + Toggleable Model Routing

**Outcome:** Deep-reasoning roles get the strongest models at `xhigh`; mechanical roles get cheaper/faster models at lower thinking. Implements the xhigh→high→xhigh "reasoning sandwich."

**Files:**
- Modify: `agent/settings.json` (add the `subagents.agentOverrides` block and `modelOverridesEnabled`)
- Modify: `agent/settings.example.json`
- Modify: `src/agents/model-routing.ts`
- Modify: `src/commands/slash.ts`
- Test: `tests/agents/model-routing.test.ts`
- Test: `tests/commands/subagents-models.test.ts`
- Reference: `agent/models.json` for exact `provider/model-id` strings

**Current implementation note:** M3 is no longer static config only. Thanos now
ships command-driven routing:

- `/subagents-models` lists current routing and usage.
- `/subagents-models-set` is a visible top-level command that opens a role
  selector, then an active-model selector from `~/.pi/agent/models.json`.
- `/subagents-models-set <role>` skips straight to the model selector for that
  role.
- `/subagents-models-toggle` is a visible top-level command that enables or
  disables per-subagent routing.

The settings shape is:

```jsonc
"subagents": {
  "disableBuiltins": true,
  "modelOverridesEnabled": true,
  "agentOverrides": {
    "reviewer": { "model": "theclawbay-claude/claude-opus-4-8:high" }
  },
  "savedAgentOverrides": {
    "reviewer": { "model": "theclawbay-claude/claude-opus-4-8:high" }
  }
}
```

When `modelOverridesEnabled` is true, `agentOverrides` is active and pi-subagents
uses the per-role assignments. When it is false, Thanos removes
`agentOverrides` and preserves assignments in `savedAgentOverrides`; the current
global `/models` selection controls every subagent, matching pre-M3 behavior.
Setting a role while disabled updates `savedAgentOverrides` without activating
the route.

**Step 1: Confirm available model ids**

Run Pi `/subagents-models-set` (and `/models`) to list the exact `provider/id` strings actually authenticated (e.g. `theclawbay-claude/claude-opus-4-8`, `theclawbay-claude/claude-haiku-4-5`, `theclawbay/gemini-2.5-pro`). Do not invent ids.

**Step 2: Add the overrides block** to `agent/settings.json` `subagents` (keep `disableBuiltins: true`):

```jsonc
"agentOverrides": {
  "oracle":              { "model": "theclawbay-claude/claude-opus-4-8:xhigh", "fallbackModels": ["theclawbay/gpt-5.5"] },
  "plan":                { "model": "theclawbay-claude/claude-opus-4-8:xhigh", "fallbackModels": ["theclawbay/gpt-5.4"] },
  "reviewer":            { "model": "theclawbay-claude/claude-opus-4-8:high",  "fallbackModels": ["theclawbay/gpt-5.5"] },
  "reviewer-correctness":{ "model": "theclawbay-claude/claude-opus-4-8:high" },
  "reviewer-security":   { "model": "theclawbay/gemini-2.5-pro:high" },
  "reviewer-tests":      { "model": "zai/glm-5.2:high" },
  "designer":            { "model": "theclawbay-claude/claude-opus-4-8:high" },
  "build":               { "model": "theclawbay-claude/claude-sonnet-4-6:high" },
  "worker":              { "model": "theclawbay-claude/claude-sonnet-4-6:high" },
  "researcher":          { "model": "theclawbay-claude/claude-sonnet-4-6" },
  "scout":               { "model": "theclawbay-claude/claude-haiku-4-5:low",  "fallbackModels": ["theclawbay/gemini-2.5-flash"] },
  "explore":             { "model": "theclawbay-claude/claude-haiku-4-5:low",  "fallbackModels": ["theclawbay/gemini-2.5-flash"] }
}
```

**Constraint to honor:** `designer` and any vision-dependent role MUST stay on an `input:["text","image"]` model (opus-4-8 / gpt-5.5 / gemini). Never route `designer` to a text-only family (GLM/Kimi/Qwen/DeepSeek) — it breaks its screenshot self-validation loop.

**Step 3: Verify** with `/subagents-models <role>` for each role; confirm the live mapping matches. Use `/subagents-models-toggle off` to verify the active `agentOverrides` block is removed and `/models` controls all subagents, then `/subagents-models-toggle on` to restore the saved assignments. Optionally bump the orchestrator: `defaultProvider: "theclawbay-claude"`, `defaultModel: "claude-opus-4-8"`.

**Step 4: Commit** `chore(settings): reasoning-sandwich model routing per role`.

---

## Milestone 4 — Per-Iteration Executable Gates with a Security Scanner

**Outcome:** Test + lint + security-scan gates run after each implementation iteration (not only at `/ship`); a non-zero result is fed back as the next step, reusing M1's re-injection discipline. "The agent never self-certifies" extended to executable checks.

**Current-state note:** The delivery-file mechanism already exists. `resolveDeliveryState()` reads `.thanos/delivery.json` through the untrusted ship-file path in `src/governance/delivery.ts`, and `agent/agents/build.md` already says delivery gates are definition of done. This milestone should add this repo's concrete gates, add a scan gate, and tighten `worker` parity; do **not** reimplement delivery resolution.

**Files:**
- Create: `.thanos/delivery.json` (repo-specific gate definitions consumed by existing `src/governance/delivery.ts`)
- Modify: `agent/agents/build.md` only if its existing delivery-gate wording needs the scan gate called out explicitly
- Modify: `agent/agents/worker.md` to match `build.md`: if `.thanos/delivery.json` exists, run each gate before reporting success and treat failures as unfinished work
- Test: `tests/governance/delivery.test.ts` or `tests/governance/delivery-types.test.ts` only if the ship-file schema needs to change; otherwise rely on existing delivery tests
- Reference skills: `@owasp-secure-scan` / `@security-review` for the scan gate

### Task 1: Add this repo's delivery gates

**Files:**
- Create: `.thanos/delivery.json`
- Test: existing delivery tests only if schema behavior changes

**Step 1: Author the ship file**

Use the existing schema: `version`, `gates`, optional `defaultBranch`, optional `merge`.

```json
{
  "version": 1,
  "gates": {
    "typecheck": "bun run typecheck",
    "lint": "bun run lint",
    "test": "bun run test",
    "scan": "<actual security scan command>"
  },
  "defaultBranch": "master"
}
```

Before committing, replace `<actual security scan command>` with the real command chosen for this repo, for example a command provided by `@owasp-secure-scan` or an existing local security script. Do not leave a placeholder command in `.thanos/delivery.json`.

**Step 2: Verify the resolver picks it up**

Run: `bunx vitest run tests/governance/delivery.test.ts`
Expected: PASS. If adding the file changes no schema logic, do not add redundant resolver tests.

**Step 3: Commit**

```bash
git add .thanos/delivery.json
git commit -m "chore(governance): define repo delivery gates"
```

### Task 2: Tighten worker/build delivery-gate instructions

**Files:**
- Modify: `agent/agents/worker.md`
- Modify: `agent/agents/build.md` only if needed

**Step 1: Update worker wording**

Add a working rule to `agent/agents/worker.md` mirroring the existing `build.md` rule:

```markdown
- If `.thanos/delivery.json` exists, its `gates` are the definition of done. Run each gate after every implementation iteration; if any gate fails, treat the task as unfinished, use the failing output as the next instruction, and do not report success until the gates pass.
```

**Step 2: Check build wording**

`agent/agents/build.md` already says delivery gates are definition of done. Only edit it if the chosen security scan needs explicit wording, and keep the diff small.

**Step 3: Manual verify on a deliberately failing change**

Introduce a throwaway failing lint/test change in a disposable worktree, dispatch `build` or `worker`, and confirm the agent treats the gate failure as unfinished work instead of returning success. Capture the transcript to `.harness/design/m4-gates.txt`, then discard the throwaway failure.

**Step 4: Commit**

```bash
git add agent/agents/worker.md agent/agents/build.md .harness/design/m4-gates.txt
git commit -m "feat(agents): enforce per-iteration delivery gates"
```

---

## Milestone 5 — Stateless Outer-Loop Ledger

**Outcome:** Long, multi-context-window jobs keep their truth in files + git, not in a single bloated context. The outer loop carries no in-context state; each iteration re-reads a durable ledger.

**Current-state note:** `agent/agents/worker.md` and `agent/agents/scout.md` already declare `defaultProgress: true`; `worker.md` already says to keep `progress.md` accurate when asked. This milestone standardizes the schema and makes the read/write obligation explicit.

**Files:**
- Modify: `agent/agents/worker.md` and `agent/agents/scout.md` (standardize `progress.md` handling alongside existing `context.md`/`plan.md` handoff)
- Modify: `docs/main-agent-orchestrator-workflow.md` (document the ledger convention)

### Task 1: Define the progress ledger schema in agent prompts

**Files:**
- Modify: `agent/agents/worker.md`
- Modify: `agent/agents/scout.md`

**Step 1: Add a compact schema**

Add this schema to both agents, adjusted for their roles:

```markdown
When `progress.md` is present or requested, keep it under ~1-2k tokens and use this schema:

# Progress

## Goal
One sentence.

## Completed
- Slice name — evidence: command/artifact/commit reference

## Remaining
- Next slice

## Open Questions
- Decision needed, or `None`

## Last Verified
Commit or command evidence.
```

**Step 2: Make read/write obligations explicit**

In `worker.md`, require reading `progress.md` at the start of each iteration when present, updating it after each verified slice, and treating git plus `progress.md` as the state of record.

In `scout.md`, require seeding `progress.md` when it is asked to create handoff context for a long or multi-slice job.

**Step 3: Commit**

```bash
git add agent/agents/worker.md agent/agents/scout.md
git commit -m "docs(agents): standardize progress ledger contract"
```

### Task 2: Document the ledger convention

**Files:**
- Modify: `docs/main-agent-orchestrator-workflow.md`

**Step 1: Add a "Durable progress ledger" section**

Document:
- `context.md` is compressed discovery context.
- `plan.md` is the intended execution sequence.
- `progress.md` is the durable source of truth for what is done, what remains, evidence links, open decisions, and last verified state.
- Rotate context proactively around 60-70% usage; keep each specialist's inner loop under half the window when possible.

**Step 2: Verify docs render plainly**

Run: `sed -n '1,220p' docs/main-agent-orchestrator-workflow.md`
Expected: the new section is readable and not duplicative.

**Step 3: Commit**

```bash
git add docs/main-agent-orchestrator-workflow.md
git commit -m "docs(orchestration): document stateless progress ledger"
```

---

## Milestone 6 — Bounded Waves Orchestrator (parallel work without state corruption)

**Outcome:** Thanos gains an explicit `/waves` or `/fanout` workflow for large research, analysis, audit, and carefully isolated implementation work. The orchestrator discovers the problem shape, decomposes into independent slices, fans out bounded parallel workers, verifies handoffs, and synthesizes one deliverable. This ports the Ray Fernando WAVES pattern into Thanos with stronger writer safety through existing subagent worktrees.

**Why this is top priority:** Fable-class systems do not rely on one linear pass when the work naturally splits. They generate independent perspectives, verify the handoffs, and synthesize. The quality lift comes from independent exploration plus disciplined selection, not unbounded agent spawning.

**Files:**
- Create: `src/waves/types.ts`
- Create: `src/waves/plan.ts`
- Create: `src/waves/prompt.ts`
- Create: `src/waves/verify.ts`
- Modify: `src/commands/slash.ts` or `src/index.ts` to register `/waves`
- Test: `tests/waves/*.test.ts`
- Docs: `docs/main-agent-orchestrator-workflow.md`

### Task 1: Define wave plan types and validation

**Files:**
- Create: `src/waves/types.ts`
- Create: `src/waves/plan.ts`
- Test: `tests/waves/plan.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { validateWavePlan } from "../../src/waves/plan";

describe("validateWavePlan", () => {
  it("accepts independent read-only slices", () => {
    expect(() => validateWavePlan({
      width: 3,
      maxDepth: 2,
      slices: [
        { id: "docs", agent: "explore", goal: "Audit docs", paths: ["docs"], mode: "read" },
        { id: "tests", agent: "explore", goal: "Audit tests", paths: ["tests"], mode: "read" },
      ],
    })).not.toThrow();
  });

  it("rejects overlapping write slices", () => {
    expect(() => validateWavePlan({
      width: 2,
      maxDepth: 2,
      slices: [
        { id: "a", agent: "worker", goal: "Edit file", paths: ["src/index.ts"], mode: "write" },
        { id: "b", agent: "worker", goal: "Also edit file", paths: ["src/index.ts"], mode: "write" },
      ],
    })).toThrow(/overlap/i);
  });

  it("caps wave width and depth", () => {
    expect(() => validateWavePlan({ width: 9, maxDepth: 4, slices: [] })).toThrow(/bounded/i);
  });
});
```

**Step 2: Run it to verify it fails**

Run: `bunx vitest run tests/waves/plan.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement minimal types + validation**

Rules:
- Width defaults to 3-8; reject `width > 8`.
- Depth defaults to 2; reject `maxDepth > 3`.
- Read slices may overlap.
- Write slices must have disjoint path sets.
- Writer slices must use a writing agent that already gets worktree isolation (`build` or `worker`), not read-only reviewers.

**Step 4: Run tests**

Run: `bunx vitest run tests/waves/plan.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/waves/types.ts src/waves/plan.ts tests/waves/plan.test.ts
git commit -m "feat(waves): validate bounded wave plans"
```

### Task 2: Build self-contained worker prompts and handoff contract

**Files:**
- Create: `src/waves/prompt.ts`
- Test: `tests/waves/prompt.test.ts`

**Step 1: Write failing tests**

Assert `buildWaveWorkerPrompt(slice, overallGoal)` includes:
- overall goal
- exact slice
- paths/sources
- scope boundaries
- required handoff format
- confidence tags
- cite-or-drop rule
- "return only the handoff"

**Step 2: Implement prompt builder**

The handoff format should require:

```markdown
Status: success | partial | blocked
Slice:
Key findings:
Evidence:
Open questions:
Suggested follow-ups:
Confidence: high | medium | low
```

For write slices, include: "Own only these paths. Do not revert sibling work. Do not spawn subagents."

**Step 3: Run tests**

Run: `bunx vitest run tests/waves/prompt.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/waves/prompt.ts tests/waves/prompt.test.ts
git commit -m "feat(waves): generate structured worker prompts"
```

### Task 3: Add handoff verification helpers

**Files:**
- Create: `src/waves/verify.ts`
- Test: `tests/waves/verify.test.ts`

**Step 1: Write failing tests**

Cover:
- missing evidence -> fail
- low-confidence handoff -> requires escalation
- conflicting statuses -> requires synthesis review
- all success with evidence -> pass

**Step 2: Implement `verifyWaveHandoffs()`**

Keep this pure. It should not judge truth deeply; it should enforce that handoffs are structured, cited, scoped, and confidence-tagged before synthesis.

**Step 3: Run tests**

Run: `bunx vitest run tests/waves/verify.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/waves/verify.ts tests/waves/verify.test.ts
git commit -m "feat(waves): verify structured worker handoffs"
```

### Task 4: Register `/waves` as an explicit opt-in orchestration command

**Files:**
- Modify: `src/commands/slash.ts` or `src/index.ts`
- Test: existing command registration tests, plus a focused `/waves` registration test

**Step 1: Add command behavior**

`/waves <goal>` should not immediately spawn arbitrary workers. It should:
1. Tell the main agent to discover the problem shape first.
2. Ask it to draft a bounded wave plan.
3. Require it to verify independence and path ownership.
4. Only then use the `subagent` tool in parallel for the approved slices.
5. Require verified handoffs before synthesis.

**Step 2: Manual verification**

Run `/waves audit this repo's spec and delivery harness for Fable-class gaps`. Expected: the main agent produces a wave plan, launches bounded independent readers, verifies handoffs, and synthesizes one report. Capture to `.harness/design/m6-waves.txt`.

**Step 3: Commit**

```bash
git add src/commands/slash.ts src/index.ts tests .harness/design/m6-waves.txt
git commit -m "feat(orchestration): add bounded waves command"
```

---

## Milestone 7 — Trace-Driven Harness Evolution (the harness improves from failures)

**Outcome:** Thanos starts treating every agent failure as harness training data. Gate loops, reviewer disagreements, failed commands, model routing choices, and final outcomes are recorded into a structured ledger. Harness changes then carry an evidence-backed prediction and can be revisited after later runs.

**Why this is top priority:** The strongest harnesses do not just add rules; they measure whether rules helped. AHE-style decision observability is what prevents the roadmap from becoming a pile of untested prompt folklore.

**Files:**
- Create: `src/observability/harness-ledger.ts`
- Create: `src/observability/change-manifest.ts`
- Test: `tests/observability/*.test.ts`
- Modify: `src/index.ts` hook points only after pure modules are tested
- Create: `docs/harness-evolution.md`

### Task 1: Add a structured harness event ledger

**Files:**
- Create: `src/observability/harness-ledger.ts`
- Test: `tests/observability/harness-ledger.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { serializeHarnessEvent } from "../../src/observability/harness-ledger";

describe("serializeHarnessEvent", () => {
  it("records gate failures with task, model, evidence, and outcome fields", () => {
    const line = serializeHarnessEvent({
      type: "gate_failure",
      taskId: "session-1",
      model: "theclawbay/gpt-5.5",
      summary: "Tests missing",
      evidence: ["Spec criterion: Tests written"],
      outcome: "needs_work",
      createdAt: "2026-06-30T00:00:00.000Z",
    });
    expect(JSON.parse(line)).toMatchObject({ type: "gate_failure", outcome: "needs_work" });
  });
});
```

**Step 2: Implement JSONL serialization**

Events should support at least:
- `gate_failure`
- `gate_pass`
- `review_disagreement`
- `wave_handoff_rejected`
- `delivery_gate_failed`
- `manual_override`
- `harness_change`

Default path: `.harness/evolution/events.jsonl`.

**Step 3: Run tests**

Run: `bunx vitest run tests/observability/harness-ledger.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/observability/harness-ledger.ts tests/observability/harness-ledger.test.ts
git commit -m "feat(observability): serialize harness evolution events"
```

### Task 2: Add harness-change manifest entries

**Files:**
- Create: `src/observability/change-manifest.ts`
- Test: `tests/observability/change-manifest.test.ts`
- Create: `.harness/evolution/changes.example.jsonl`

**Step 1: Write failing tests**

A manifest entry must require:
- failure evidence
- root cause
- targeted fix
- predicted impact
- regression risk
- follow-up check date or condition

**Step 2: Implement manifest validation**

Keep validation pure. Do not wire it to git yet.

**Step 3: Run tests**

Run: `bunx vitest run tests/observability/change-manifest.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/observability/change-manifest.ts tests/observability/change-manifest.test.ts .harness/evolution/changes.example.jsonl
git commit -m "feat(observability): validate harness change manifests"
```

### Task 3: Wire minimal event capture into existing hooks

**Files:**
- Modify: `src/index.ts`
- Test: focused hook tests where practical

**Step 1: Capture only high-signal events first**

Record:
- M1 verification gate re-injection
- delivery gate failure if available
- `/review` jury disagreement once M2 exists
- `/waves` handoff rejection once M6 exists

Do not log full prompts, secrets, or raw tool output. Store summaries and artifact paths.

**Step 2: Run focused tests + CI**

Run: `bun run ci`
Expected: PASS.

**Step 3: Commit**

```bash
git add src/index.ts tests
git commit -m "feat(observability): record high-signal harness events"
```

### Task 4: Document the evolve loop

**Files:**
- Create: `docs/harness-evolution.md`

**Step 1: Document the operating rule**

Every harness change should answer:
1. What failure evidence motivated this?
2. What root cause do we believe explains it?
3. What exact harness component changed?
4. What outcome should improve?
5. What regression might this cause?
6. When will we check whether it helped?

**Step 2: Commit**

```bash
git add docs/harness-evolution.md
git commit -m "docs(harness): add trace-driven evolution loop"
```

---

## Cross-Cutting: testing, rollout, and risks

**Test strategy**
- Pure logic (M0 Tasks 1 and 3; M1 Tasks 1–4; M2 Task 2; M6 Tasks 1–3; M7 Tasks 1–2) is fully unit-tested with Vitest — these are the load-bearing decisions and must be green in `bun run ci`.
- M1 Task 5 adds hook-level coverage in `tests/index.test.ts` for continuation preservation and follow-up re-injection.
- Event-wiring (`agent_end`, `before_agent_start`, `/review`, `/waves`) and config (M3/M4/M5/M7) are verified by scripted manual runs with captured transcripts under `.harness/design/`, because the Pi event loop has no in-repo integration harness. Each milestone names its evidence artifact.

**Rollout order & shippability**
- M0 first — M1's gate is only as strong as the contract it enforces.
- M1 second — self-contained and every later milestone (M2/M4/M6/M7) reuses its re-injection discipline.
- M3 should land before M2 Task 4 (the jury needs heterogeneous routing to be meaningful).
- M6 should land after M5 so waves have a durable progress ledger and handoff convention.
- M7 should land after M1 and can be expanded after M2/M6 add more event sources.
- Each milestone is a separate commit series and can ship independently.

**Risks & mitigations**
- *Weak contracts create fake confidence* → M0 makes criteria default-fail and evidence-specific; M1 only enforces criteria that require concrete evidence.
- *Infinite re-injection loop* → bounded by `GATE_MAX_ATTEMPTS` (3) + sentinel-guarded `before_agent_start` so the original spec/evidence survive the continuation turn. Verified explicitly in M1 Task 5 Step 6.
- *Gate fires in subagents / instant-tier prompts* → `shouldReinject` returns false for `isSubagent`, empty results, and disabled env.
- *Cost blow-up from routing strong models everywhere* → recon roles (scout/explore) pinned to cheap/fast models; sandwich spends thinking only at plan/verify.
- *Vision regression* → M3 constraint forbids routing `designer` to text-only families.
- *Provider id drift* → M3 Step 1 reads ids live from `/subagents-models`; never hard-code unverified ids.
- *Parallel workers corrupt state* → M6 read waves can overlap, but write waves require disjoint paths and existing worktree-isolated writer agents.
- *Wave loops burn tokens without improving quality* → M6 caps width at 8 and depth at 3; verification is the stop function.
- *Harness folklore accumulates* → M7 requires failure evidence, root cause, predicted impact, and later falsification for harness changes.

**Definition of done (whole roadmap):** `bun run ci` green; default-fail contracts are richer than keyword criteria; a fresh-context evaluator can return PASS/NEEDS_WORK; M1 gate re-injects-then-stops within budget on a live run; `/review` produces a heterogeneous jury verdict; `/subagents-models` shows the sandwich routing; `.thanos/delivery.json` gates run per-iteration; `progress.md` ledger persists across a multi-iteration task; `/waves` runs a bounded fan-out with verified handoffs; harness evolution events and change manifests are recorded. ADR 0006 recorded.
