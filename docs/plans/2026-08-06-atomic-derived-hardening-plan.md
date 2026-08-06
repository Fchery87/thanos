# Atomic-Derived Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close two confirmed delegation-budget defects, adopt structured outputs that pi-subagents already ships, reshape the specialist roster from role-shaped to evidence-shaped, and record the vendor-vs-patch decision with explicit tripwires.

**Architecture:** Scope A — stay on `pi-subagents@0.41.0` as a dependency. Defects that live in upstream code get one new hunk in the existing `scripts/patches/pi-subagents-0.41.0-evidence.patch` artifact, guarded by a behaviour verifier in the same self-healing style the patch script already uses. Defects that live in Thanos code get fixed in `src/` and `agent/agents/`. No upstream surface is taken into ownership.

**Tech Stack:** TypeScript (strict), vitest (`bun run test` — never bare `bun test`), `git apply` patch artifacts, markdown frontmatter agent manifests.

---

## Provenance

Every claim below was verified against the working tree at `/home/nochaserz/.pi` and `node_modules/pi-subagents@0.41.0` on 2026-08-06. File:line references are load-bearing — re-verify them if `pi-subagents` moves off 0.41.0 before this plan is executed.

Two corrections to the Atomic review that produced this plan:

1. The fallback-ladder defect is **not** caused by `needsAttentionAfterMs`. That knob is a notice, not a kill (`subagent-control.ts:84` returns the string `"needs_attention"`). Bumping it to 720000ms never affected termination. The real path is the wall-clock attempt timeout.
2. `outputSchema`, `as:` named outputs, and `dynamic-fanout.ts` are **already present in 0.41.0**. They were misattributed to Atomic's fork. Phase 2 is adoption of an existing capability, not new construction.

---

## Phase 0 — Two confirmed budget defects

### Bug A: both declared budgets are dead fields

The complete set of frontmatter keys pi-subagents 0.41.0 reads is fixed and enumerable from `src/agents/agents.ts`. Against that list, two of the three budget keys Thanos declares are **not read at all**:

| Thanos declares | Read by 0.41.0? | Live key | Declared in |
| --- | --- | --- | --- |
| `maxExecutionTimeMs` | **No** | `timeoutMs` (`agents.ts:1550`) | 13/13 profiles |
| `maxTurns` | **No** | `turnBudget` (`agents.ts:1558`) | 11/13 profiles |
| `maxSubagentDepth` | Yes | — | as-is |

`maxExecutionTimeMs` and `maxTokens` were real in an older release — the CHANGELOG records them — and upstream has since renamed them. Neither string appears anywhere in 0.41.0 source.

Consequences:
- **Time:** every agent falls back to `DEFAULT_FOREGROUND_TIMEOUT_MS = 30 * 60 * 1000` (`subagent-executor.ts:1926`, applied at `:4045`). `explore` declares 10 minutes and actually gets 30.
- **Turns:** every agent runs with no turn budget at all. Declared values span 20–40 across the roster and bind nothing.

Note `turnBudget` is **not** a plain-integer rename. It is JSON-parsed (`agents.ts:1559`) into `TurnBudgetConfig { maxTurns: number; graceTurns?: number }` (`shared/types.ts:108-111`), so the frontmatter value is a JSON object string.

Three Thanos surfaces assert these dead fields are real:
- `src/agents/manifest.ts:43-44` validates `maxExecutionTimeMs` is positive
- `tests/agents/roster-contract.test.ts:141` asserts both are positive integers
- `src/runtime/before-agent-start.ts:35` tells the model *"every agent has its own maxExecutionTimeMs budget"* — a false statement in the system prompt

The suite is green over two fields that do nothing.

### Bug B: a timeout is misclassified as a retryable model failure

`formatTimeoutMessage` (`execution.ts:169`) emits `` `Subagent timed out after ${timeoutMs}ms.` ``. `RETRYABLE_MODEL_FAILURE_PATTERNS` (`model-fallback.ts:295-313`) contains both `/timed? out/i` and `/timeout/i`. `isRetryableModelFailure` (`:325`) has one guard — `TOOL_FAILURE_PREFIX`, which only excludes `<tool> failed (exit N)` shapes — so the timeout message matches. `execution.ts:1606` then advances the model ladder:

```ts
if (!isRetryableModelFailure(result.error) || modelIndex === modelsToTry.length - 1) break modelAttemptsLoop;
```

Consequence: an attempt that exhausts its wall clock re-runs **the entire task** on the next model. Foreground runs always have a timeout (`:4045` falls back to the 30-minute default), so this path is always reachable. `agent/agents/worker.md` carries a long fallback ladder; each rung is a full task re-run.

Bug A amplifies Bug B: budgets are 30 minutes instead of the declared 10–20, so a run burns 30 minutes before misclassifying and re-running.

Thanos's current mitigation is a prompt string at `before-agent-start.ts:35` asking the model not to pass short timeouts. That is exactly the "checklist a model may choose to follow" failure mode.

---

### Task 0.1a: Pin the live frontmatter key set

Before renaming anything, freeze the ground truth so a future upstream rename fails loudly instead of silently re-creating this bug.

**Files:**
- Create: `tests/agents/frontmatter-keys.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// The one thing this suite must never let drift: which frontmatter keys
// pi-subagents actually reads. A rename upstream turns a declared budget
// into an inert string with no error anywhere.
const AGENTS_TS = createRequire(import.meta.url).resolve("pi-subagents/package.json")
  .replace(/package\.json$/, "src/agents/agents.ts");

describe("pi-subagents frontmatter contract", () => {
  const source = readFileSync(AGENTS_TS, "utf-8");
  const read = new Set(
    [...source.matchAll(/frontmatter\.([a-zA-Z]+)/g)].map((m) => m[1]),
  );

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
```

**Step 2: Run — this one passes immediately.** It is a regression guard, not a red test.

Run: `bun run test -- tests/agents/frontmatter-keys.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/agents/frontmatter-keys.test.ts
git commit -m "test(agents): pin the pi-subagents frontmatter key contract"
```

---

### Task 0.1b: Move both budgets onto the live keys

**Files:**
- Modify: `agent/agents/*.md` (13 files)
- Test: `tests/agents/roster-contract.test.ts`

**Step 1: Write the failing test**

Add to `tests/agents/roster-contract.test.ts`:

```ts
it("declares budgets under the frontmatter keys pi-subagents actually parses", async () => {
  // See tests/agents/frontmatter-keys.test.ts for the pinned key set.
  // Agents declaring the retired keys silently inherit
  // DEFAULT_FOREGROUND_TIMEOUT_MS (30m) and no turn budget at all.
  const roster = await loadRoster();
  expect(roster.length).toBeGreaterThan(0);
  for (const agent of roster) {
    expect(
      agent.maxExecutionTimeMs,
      `${agent.file}: maxExecutionTimeMs is retired; use timeoutMs`,
    ).toBeUndefined();
    expect(
      agent.maxTurns,
      `${agent.file}: maxTurns is retired; use turnBudget`,
    ).toBeUndefined();
    expect(agent.timeoutMs, `${agent.file} must declare timeoutMs`).toBeGreaterThan(0);
    // turnBudget is optional — 2 of 13 profiles (scout, worker) never declared
    // maxTurns and this task must not fabricate one for them (pi-subagents'
    // own resolveTurnBudgetConfig treats "no turn budget" as valid). Where a
    // turnBudget IS declared, it must parse as JSON with a positive maxTurns.
    if (agent.turnBudget !== undefined) {
      expect(
        JSON.parse(agent.turnBudget).maxTurns,
        `${agent.file} turnBudget must be JSON with a positive maxTurns`,
      ).toBeGreaterThan(0);
    }
  }
});
```

`loadRoster()` builds records from a fixed key list at `roster-contract.test.ts:58` — add `timeoutMs: numeric("timeoutMs")` and a raw-string `turnBudget` entry so the new keys are read.

**Step 2: Run test to verify it fails**

Run: `bun run test -- tests/agents/roster-contract.test.ts`
Expected: FAIL — 13 declare `maxExecutionTimeMs`, 11 declare `maxTurns`, 0 declare either live key.

**Step 3: Migrate the frontmatter**

`timeoutMs` is a plain rename. `turnBudget` is **not** — it is JSON-parsed into `{ maxTurns, graceTurns? }`, so the value must become a JSON object string.

```bash
cd /home/nochaserz/.pi
sed -i 's/^maxExecutionTimeMs:/timeoutMs:/' agent/agents/*.md
sed -i -E 's/^maxTurns: ([0-9]+)$/turnBudget: {"maxTurns": \1}/' agent/agents/*.md

# verify: 13 timeoutMs, 11 turnBudget, 0 retired keys
grep -c "^timeoutMs:" agent/agents/*.md | grep -vc ":0"
grep -h "^turnBudget:" agent/agents/*.md | wc -l
grep -l "^maxExecutionTimeMs:\|^maxTurns:" agent/agents/*.md || echo "no retired keys remain"
```

Preserve the declared values — this task fixes the key, not the budget. Re-tuning belongs in a separate change with measurement behind it.

**Step 4: Run test to verify it passes**

Run: `bun run test -- tests/agents/`
Expected: PASS

**Step 5: Smoke-test that a budget now binds**

A green suite is not proof the runtime honours the key. Dispatch one real child with a deliberately tiny budget and confirm it stops:

```bash
# temporary: set explore to a 2-turn budget, then dispatch it
timeout 900 pi -p --approve "use the explore subagent to list every file under src/agents"
grep -i "turn budget\|budgetExceeded\|resourceLimit" agent/run-history.jsonl | tail -3
```

Expected: the child stops on the turn budget rather than running to completion. Revert the temporary value afterward.

**Step 6: Commit**

```bash
git add agent/agents/ tests/agents/roster-contract.test.ts
git commit -m "fix(agents): move time and turn budgets onto the keys pi-subagents reads

maxExecutionTimeMs (13 profiles) and maxTurns (11 profiles) are read by no
0.41.0 code path. Every agent silently ran on the 30-minute foreground
default with no turn budget at all. Live keys are timeoutMs and turnBudget,
the latter a JSON TurnBudgetConfig rather than a plain integer."
```

---

### Task 0.2: Make the validator track the live key

**Files:**
- Modify: `src/agents/manifest.ts:5-16` (interface), `:43-45` (validation)
- Test: `tests/agents/manifest.test.ts:26`

**Step 1: Write the failing test**

In `tests/agents/manifest.test.ts`:

```ts
it("rejects the retired maxExecutionTimeMs key outright", () => {
  expect(() =>
    validateManifest("explore", { maxExecutionTimeMs: 600000 } as AgentManifest),
  ).toThrow(/maxExecutionTimeMs is retired; use timeoutMs/);
});

it("requires timeoutMs to be positive when present", () => {
  expect(() => validateManifest("explore", { timeoutMs: 0 })).toThrow(
    /must declare a positive timeoutMs/,
  );
  expect(() => validateManifest("explore", { timeoutMs: 600000 })).not.toThrow();
});
```

**Step 2: Run to verify it fails**

Run: `bun run test -- tests/agents/manifest.test.ts`
Expected: FAIL — `timeoutMs` is not on `AgentManifest`.

**Step 3: Implement**

In `src/agents/manifest.ts`, replace the `maxExecutionTimeMs?: number;` and `maxTurns?: number;` interface members with:

```ts
  timeoutMs?: number;
  turnBudget?: { maxTurns: number; graceTurns?: number };
  /** Retired keys. pi-subagents 0.41.0 reads neither; kept only to reject them loudly. */
  maxExecutionTimeMs?: number;
  maxTurns?: number;
```

and replace the `:43-45` validation block with:

```ts
  const RETIRED: ReadonlyArray<[keyof AgentManifest, string]> = [
    ["maxExecutionTimeMs", "timeoutMs"],
    ["maxTurns", "turnBudget"],
  ];
  for (const [retired, live] of RETIRED) {
    if (manifest[retired] !== undefined) {
      throw new Error(
        `${role}: ${retired} is retired; use ${live} (pi-subagents reads ${live} frontmatter)`,
      );
    }
  }

  if (manifest.timeoutMs !== undefined && manifest.timeoutMs <= 0) {
    throw new Error(`${role} must declare a positive timeoutMs`);
  }

  if (manifest.turnBudget !== undefined && manifest.turnBudget.maxTurns <= 0) {
    throw new Error(`${role} must declare a positive turnBudget.maxTurns`);
  }
```

Then update `src/agents/loader.ts:118-119` to parse `timeoutMs` and JSON-parse `turnBudget` instead of the retired keys, and update the caller at `roster-contract.test.ts:179`.

**Step 4: Run the agent suite**

Run: `bun run test -- tests/agents/`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agents/ tests/agents/
git commit -m "fix(agents): validate timeoutMs and reject the retired maxExecutionTimeMs key"
```

---

### Task 0.3: Correct the false claim in the system prompt

**Files:**
- Modify: `src/runtime/before-agent-start.ts:35`
- Test: `tests/prompt-system/` (locate the assertion covering this string)

**Step 1: Write the failing test**

```ts
it("does not promise a budget field that upstream does not read", async () => {
  const prompt = await buildBeforeAgentStartGuidance();
  expect(prompt).not.toContain("maxExecutionTimeMs");
  expect(prompt).toContain("timeoutMs budget");
});
```

**Step 2: Run to verify it fails**

Run: `bun run test -- tests/prompt-system/`
Expected: FAIL — the string is present.

**Step 3: Implement**

Replace the `before-agent-start.ts:35` string with:

```ts
  "Do NOT pass timeoutMs/maxRuntimeMs when delegating — every agent declares its own timeoutMs budget, and short caller timeouts kill healthy runs mid-flight, wasting all their work. If you must bound a run, use at least 600000 (10 minutes).",
```

**Step 4: Run and commit**

```bash
bun run test -- tests/prompt-system/
git add src/runtime/before-agent-start.ts tests/prompt-system/
git commit -m "fix(prompts): stop promising a budget field pi-subagents does not read"
```

---

### Task 0.4: Stop a timeout from burning the fallback ladder

**Files:**
- Modify: `scripts/patches/pi-subagents-0.41.0-evidence.patch` (new hunk)
- Modify: `scripts/patch-pi-subagents.mjs` (`PATCH_MARKERS` at `:82`, new verifier)
- Test: `tests/scripts/` (patch-script suite)

**Step 1: Write the failing behaviour test**

Add `tests/delegation/timeout-classification.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isRetryableModelFailure } from "pi-subagents/../src/runs/shared/model-fallback.ts";

describe("timeout classification", () => {
  it("does not treat a subagent wall-clock timeout as a retryable model failure", () => {
    // A timeout means the child ran out of its own budget. Retrying a
    // different model re-runs the whole task and cannot fix it — the same
    // reasoning upstream already applies to TOOL_FAILURE_PREFIX.
    expect(isRetryableModelFailure("Subagent timed out after 1800000ms.")).toBe(false);
  });

  it("still treats genuine provider timeouts as retryable", () => {
    expect(isRetryableModelFailure("upstream request timeout")).toBe(true);
    expect(isRetryableModelFailure("504 Gateway Timeout")).toBe(true);
  });
});
```

**Step 2: Run to verify it fails**

Run: `bun run test -- tests/delegation/timeout-classification.test.ts`
Expected: FAIL — first assertion returns `true`.

**Step 3: Add the patch hunk**

Append to `scripts/patches/pi-subagents-0.41.0-evidence.patch`, mirroring upstream's own `TOOL_FAILURE_PREFIX` guard:

```diff
diff --git a/src/runs/shared/model-fallback.ts b/src/runs/shared/model-fallback.ts
--- a/src/runs/shared/model-fallback.ts
+++ b/src/runs/shared/model-fallback.ts
@@
 const TOOL_FAILURE_PREFIX = /^[\w.:@/-]+ failed (?:(?:\(exit \d+\):)|(?:with exit code \d+))(?:\s|$)/i;
 
+/**
+ * thanos-patch: subagent wall-clock timeout is not a model failure
+ * (remove after upstream support)
+ *
+ * `formatTimeoutMessage` emits "Subagent timed out after Nms." which matches
+ * both /timed? out/i and /timeout/i below. Classifying it as retryable makes
+ * execution.ts:1606 advance the model ladder and re-run the entire task on the
+ * next candidate. The child exhausted its own budget; no other model fixes that.
+ */
+const SUBAGENT_TIMEOUT_PREFIX = /^subagent timed out after \d+ms/i;
+
 export function isRetryableModelFailure(error: string | undefined): boolean {
 	if (!error) return false;
 	if (TOOL_FAILURE_PREFIX.test(error.trim())) return false;
+	if (SUBAGENT_TIMEOUT_PREFIX.test(error.trim())) return false;
 	return RETRYABLE_MODEL_FAILURE_PATTERNS.some((pattern) => pattern.test(error));
 }
```

**Step 4: Register the marker and a behaviour verifier**

In `scripts/patch-pi-subagents.mjs`, add to `PATCH_MARKERS` (`:82`):

```js
  ["runs/shared", "model-fallback.ts", "thanos-patch: subagent wall-clock timeout is not a model failure"],
```

Then add a verifier alongside `verifyFanoutGuard()` / `verifyV2EvidenceEnvelope()`, following the file's stated principle that *behaviour is the gate*:

```js
function verifyTimeoutClassification() {
  const file = join(ROOT, "runs", "shared", "model-fallback.ts");
  if (!existsSync(file)) return { status: "skipped", reason: "model-fallback.ts missing" };
  try {
    const probe = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "-e",
       `import {isRetryableModelFailure} from ${JSON.stringify(file)};` +
       `process.stdout.write(String(isRetryableModelFailure("Subagent timed out after 1800000ms.")));`],
      { encoding: "utf-8" },
    );
    if (probe.status !== 0) {
      return { status: "skipped", reason: `probe did not run (${(probe.stderr ?? "").trim()})` };
    }
    return probe.stdout.trim() === "false"
      ? { status: "ok", reason: "subagent wall-clock timeout is not classified as a retryable model failure" }
      : { status: "broken", reason: "subagent timeout still advances the model fallback ladder" };
  } catch (error) {
    return { status: "skipped", reason: error instanceof Error ? error.message : String(error) };
  }
}
```

and register it: `const verdicts = [verifyFanoutGuard(), verifyV2EvidenceEnvelope(), verifyTimeoutClassification()];`

**Step 5: Apply, verify, commit**

```bash
node scripts/patch-pi-subagents.mjs
# expect: "[thanos-patch] verified: subagent wall-clock timeout is not classified as a retryable model failure"
bun run test -- tests/delegation/timeout-classification.test.ts tests/scripts/
git add scripts/ tests/delegation/timeout-classification.test.ts
git commit -m "fix(delegation): stop a subagent wall-clock timeout from burning the model ladder"
```

**Step 6: Draft the upstream PR**

This hunk is small, self-contained, and mirrors a guard upstream already wrote. Open it against `nicobailon/pi-subagents` — if it lands, this hunk retires and the patch script's existing "upstream absorbed the fix" path handles it automatically.

---

## Phase 1 — Spec discipline scaffold

Atomic carries 129 dated specs with a fixed shape: metadata table, tracking issue, explicit **compatibility posture**, numbered goals/non-goals as checkboxes, an architecture diagram, and a **deletion inventory**. Thanos has `docs/adr/` (22 entries) and `docs/plans/` (6) but no spec template and no deletion inventory. The deletion inventory is the piece worth importing — it is what turns "we added a thing" into "we removed the thing it replaced."

### Task 1.1: Add the spec template

**Files:**
- Create: `docs/specs/TEMPLATE.md`
- Modify: `AGENTS.md` (point at it)

Template sections, in order: metadata table (author, status, created/updated, tracking issue, **compatibility posture**) · executive summary · context and motivation with cited research paths · current state · the problem · goals as `- [ ]` checkboxes · **non-goals as `- [ ]` checkboxes** · proposed solution · key components table · **deletion inventory** · risks · rollout.

The two sections that carry the weight are non-goals and the deletion inventory. Atomic's in-process runner spec declines Codex's mailbox protocol *with a decision-record reference* — that is the standard to match.

**Commit:** `docs(specs): add spec template with compatibility posture and deletion inventory`

### Task 1.2: Backfill one spec retroactively

Write `docs/specs/2026-08-06-delegation-budget-defects.md` covering Phase 0 using the new template. Backfilling one real spec proves the template survives contact; a template no one has used is a guess.

**Commit:** `docs(specs): record the delegation budget defects and their fixes`

---

## Phase 2 — Adopt structured outputs (already shipped upstream)

pi-subagents 0.41.0 already exposes, in `src/extension/schemas.ts`:
- `outputSchema` on chain steps, parallel tasks, and single runs (`:139`, `:170`, `:186`, `:200`, `:352`)
- `as:` named outputs referenced downstream as `{outputs.name}` (`:138`, `:199`)
- `dynamic-fanout.ts` for data-dependent expansion with a required `maxItems` bound

Thanos's `DelegationRuntime` (`src/delegation/runtime.ts`) does not surface any of it. `DelegationInput` extends `DelegationRequest` minus `requestId`/`ownerRunId`, and `src/api/delegation.ts:45` carries only `result: SubagentDelegationResultRequest`. So Thanos's evidence gate consumes free text where a validated object is available.

### Task 2.1: Thread `outputSchema` through DelegationInput

**Files:**
- Modify: `src/delegation/runtime.ts:17-20`
- Modify: `src/delegation/evidence.ts` (envelope typing)
- Test: `tests/delegation/runtime.test.ts`

**Step 1: Failing test**

```ts
it("forwards a declared outputSchema to the delegation request", async () => {
  const emitted: unknown[] = [];
  const events = fakeEventBus(emitted);
  const runtime = new DelegationRuntime(events, "run-1");
  const schema = { type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] };

  void runtime.delegate({ nodeId: "n1", agent: "reviewer", task: "review", outputSchema: schema });

  const request = emitted.find(isDelegationRequest);
  expect(request?.outputSchema).toEqual(schema);
});
```

**Step 2:** Run — FAIL, `outputSchema` is not on `DelegationInput`.

**Step 3:** Add `outputSchema?: Record<string, unknown>` to `DelegationInput` and pass it through the `request` construction at `runtime.ts:34-38`.

**Step 4:** Run — PASS. **Step 5:** Commit.

### Task 2.2: Validate structured output at the evidence gate

**Files:**
- Modify: `src/delegation/evidence.ts` (`validateDelegationEvidence`)
- Test: `tests/delegation/evidence.test.ts`

Add a verdict branch: when a request declared `outputSchema` and the response's structured value is absent or fails validation, the outcome is `failed` with a reason naming the violated field — **not** a pass with unparsed text. This is the Thanos analogue of Atomic's `goal-reducer.ts`: completion decided by code over a typed object.

Keep it default-fail, consistent with ADR 0018.

**Commit:** `feat(delegation): gate acceptance on declared outputSchema, default-fail on violation`

### Task 2.3: Adopt named outputs in one wave

**Files:**
- Modify: `src/waves/` (the parallel investigation step)

Give each parallel investigator an `as:` name and an `outputSchema`, then have the integration step read `{outputs.<name>}` instead of parsing prose. Do exactly one wave stage first and measure before converting the rest.

**Commit:** `feat(waves): use named structured outputs for the investigation step`

---

## Phase 3 — Evidence-shaped roster

Current roster (`src/agents/catalog.ts:1-4`) is role-shaped: `explore, plan, build, reviewer, designer, oracle, researcher, evaluator, scout, worker, reviewer-correctness, reviewer-security, reviewer-tests`.

Atomic's is capability-shaped, and its subagent skill states the rule: *"There is no generic `reviewer` agent — assemble the review from read-only specialists with distinct angles."* Thanos already half-believes this — the three `reviewer-*` variants are exactly that decomposition. The remaining generic `reviewer` is the inconsistency.

This phase is taste, not defect. Sequence it after Phase 2 because structured outputs are what make angle-specific reviewers composable.

### Task 3.1: Record the decision first

Write `docs/adr/0023-review-is-assembled-from-angles-not-delegated-to-a-reviewer.md`. State the rule, the evidence (Atomic's roster, your own `reviewer-*` split), and what it forbids.

**Commit:** `docs(adr): review is assembled from angles, not delegated to a reviewer`

### Task 3.2: Retire the generic `reviewer`

**Files:**
- Modify: `src/agents/catalog.ts` (remove `"reviewer"` from `SpecialistId` and `CATALOG`)
- Delete: `agent/agents/reviewer.md`
- Modify: any `mayDelegate` list naming `reviewer`
- Test: `tests/agents/catalog.test.ts`, `tests/agents/roster-contract.test.ts`

The type system does the work: removing `"reviewer"` from the `SpecialistId` union produces a compile error at every reference. Run `bun run typecheck` and fix each site by naming a specific angle.

**Verify:** `bun run typecheck && bun run test -- tests/agents/`

**Commit:** `refactor(agents): retire the generic reviewer in favour of angle-specific variants`

### Task 3.3: Add the two missing angles

Atomic's roster covers two angles Thanos lacks:
- **pattern fit** — "find similar implementations and usage examples" (`codebase-pattern-finder`)
- **prior decisions** — "extract decisions and rationale from local research" (`codebase-research-analyzer`), which maps onto `docs/adr/` and `docs/research/`

Both are read-only, `contextModes: READ_ONLY`, `mayDelegate: NO_DELEGATION`, `maxSubagentDepth: 0`. Add as `reviewer-patterns` and `reviewer-decisions` to keep the existing naming convention.

**Commit:** `feat(agents): add pattern-fit and prior-decision review angles`

---

## Phase 4 — Vendor decision record

Scope A is a bet that patching stays cheaper than owning. That bet has failure conditions, and they should be written down now, while the reasoning is fresh, rather than re-litigated under pressure at the next break.

### Task 4.1: Write the ADR with tripwires

**Files:**
- Create: `docs/adr/0024-pi-subagents-stays-a-dependency-until-these-tripwires-fire.md`

State the decision (stay on the dep), the reasoning (18k LOC layer should not own a 66k LOC runtime without a port-matrix discipline), and the evidence from `scripts/patch-pi-subagents.mjs`'s own history — the discovery patch retired after 0.36.0 changed the shape it anchored to, and the 0.37.2 evidence patch that could not be forward-ported because upstream deleted its target.

Tripwires, any one of which reopens the decision:

- [ ] A patch fails to forward-port to a new pi-subagents release **and** its behaviour verifier reports `broken`
- [ ] The patch artifact exceeds **4** hunks
- [ ] Upstream declines, or leaves unmerged for two minor releases, the evidence-projection PR that ADR 0019 depends on
- [ ] A defect is found that cannot be expressed as a patch hunk at all — e.g. one requiring a deletion, as Atomic's watchdog removal did

Record what vendoring would cost if triggered: ~66k LOC owned, a `research/pi-subagents-port-matrix.md` per upstream release, and the deletion of `scripts/patch-pi-subagents.mjs`. Atomic's `research/` directory is the reference implementation of that discipline.

**Commit:** `docs(adr): pi-subagents stays a dependency until these tripwires fire`

### Task 4.2: Make one tripwire mechanical

**Files:**
- Modify: `scripts/patch-pi-subagents.mjs`

The hunk-count tripwire can enforce itself. After the verdict block, add:

```js
const HUNK_CEILING = 4;
const hunkCount = readFileSync(EVIDENCE_PATCH, "utf-8").split(/^@@ /m).length - 1;
if (hunkCount > HUNK_CEILING) {
  console.error(
    `[thanos-patch] patch artifact has ${hunkCount} hunks (ceiling ${HUNK_CEILING}) — ` +
      "ADR 0024 tripwire: reopen the vendor-vs-patch decision.",
  );
}
```

Report, do not fail — a tripwire is a prompt to decide, not a broken build.

**Commit:** `chore(patch): warn when the patch artifact crosses the ADR 0024 hunk ceiling`

---

## Sequencing and verification

| Phase | Depends on | Gate before moving on |
| --- | --- | --- |
| 0 | — | `bun run ci` green; `node scripts/patch-pi-subagents.mjs` reports all three verifiers `ok` |
| 1 | — | template exists and one spec backfilled against it |
| 2 | 0 (budgets must be real before measuring runs) | one wave stage converted, evidence gate default-fails on schema violation |
| 3 | 2 (structured outputs make angles composable) | `bun run typecheck` clean after the union narrows |
| 4 | 0 (tripwires reference the real patch shape) | ADR written, hunk-count warning fires on a synthetic 5-hunk artifact |

Phases 0 and 1 are independent and can run in parallel. Phase 0 is the only one fixing confirmed defects — if the plan gets cut short, cut from the bottom.

**Full verification:** `bun run ci` (typecheck + lint + `vitest run`). Use `bun run test`, never bare `bun test` — the wrong runner produces roughly 26 phantom failures.

**Worktree:** execute in one, per superpowers:using-git-worktrees. The current branch is `feat/pi-subagents-0.41.0-migration`, which already carries the 0.41.0 migration; Phase 0 belongs on a branch off it, not on `master`.

---

## What this plan deliberately does not do

- [ ] NOT vendoring pi-subagents (Scope A; revisit only via ADR 0024 tripwires)
- [ ] NOT porting a Rust control plane — disproportionate for an 18k-LOC config layer
- [ ] NOT adopting DBOS or durable workflow execution — `/waves` journaling already covers the recoverability Thanos needs
- [ ] NOT deleting the watchdog — it cannot be expressed as a patch hunk, and that is itself an ADR 0024 tripwire
- [ ] NOT changing delivery modes or the permission surface — unrelated to this review, and the area where Thanos already leads Atomic
