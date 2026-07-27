# Plan: repair the spec-verification evidence plane

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task-by-task.

**Goal:** Make spec verification measure outcomes instead of intentions. Close the
consent hole where a rejected spec is restarted by the gate, replace tool-input
trust with git ground truth, teach the evidence recognizer this repo's real test
command, and wire the semantic contract extractor that has been stubbed since the
seam was introduced.

**Architecture:** No new subsystems. The turn lifecycle
(`before_agent_start` → `tool_result` → `agent_end` → `shouldReinject`) is correct
and stays as-is. Every change lands in one of three places: the evidence recognizer
(`src/spec/evidence.ts`), the verifier's inputs (`src/spec/verification.ts`), or the
`agent_end` handler (`src/runtime/governance-hooks.ts`). One new seam —
`SpecEngine.pendingContract: Promise<TaskContract | undefined>` — carries the
extractor's async result without making generation async.

**Tech Stack:** TypeScript, vitest, bun. Existing modules: `src/spec`, `src/runtime`,
`src/hooks`, `src/audit`, `src/goal`.

### Honest completion ledger

**All ten tasks complete on branch `restore-pre-sync`.** Suite 1152 passed,
typecheck and lint clean.

| Task | Commit | Notes |
|---|---|---|
| 1 consent | `76742f7` | dropped the write-only `status` assignment; removed the now-unreachable "(spec was rejected)" note |
| 2 dead code | `622967c` | `src/spec/` 13 modules → 11 |
| 3 seam tests | `bc0db7b` | `it.fails` instead of literal red — see below |
| 4 commands | `cecea2b` | scope widened to non-JS runners, which forced two schema fixes |
| 5 paths | `a48a9d6` | |
| 6 git truth | `a464b55` | `diff-evidence.ts` rewritten, not revived — see below |
| 7 reporting | `f62adfd` | renderers not merged — see below |
| 8 promise seam | `9e75aad` | behaviour-neutral, ships separately per Principle 4 |
| 9 extractor | `227cf5d` | + `mustNot` scoping, same commit as required |
| 10 residuals | `7dcd9f4` | `classify()` deliberately unchanged — see below |

**Deviations from this plan, all deliberate:**

- **Task 3** used `it.fails` rather than committing literally-red tests. CI runs
  `test:unit` over `tests/spec` on every push, so red commits would have broken
  the branch from Task 3 until Task 6 — a cost this document understated. Each
  marker is self-enforcing: it starts failing the moment its task fixes the
  behaviour, forcing the flip to `it`.
- **Task 6** rewrote `diff-evidence.ts` instead of reviving `validateDiffEvidence`.
  That function parsed `git diff HEAD` and hand-synthesized patches for untracked
  files, had no notion of a baseline, and produced far more than the path list and
  hash actually consumed. Snapshot-and-compare over `git status --porcelain -z`
  handles untracked files natively and makes deletions and reverts fall out.
- **Task 7** did not merge the two panels. They serve different purposes (compact
  turn summary vs. full spec panel); the drift was in how a criterion *line* was
  spelled, so `renderCriteriaLines` was extracted instead.
- **Task 10** kept `REJECTED_COMMAND_EXECUTABLES` as a denylist rather than
  inverting it, **reversing this document's own recommendation**. Over-restriction
  here rejects genuine evidence and re-creates the retry loop the whole plan
  exists to remove. The first attempt at a flat denylist broke the audit fast-lane
  regression test, because `rg` is how an audit corroborates findings — the
  rejection is now scoped to gated criteria only.
- **Task 10** left `classify()`'s 20-char threshold alone. Measured, as this plan
  required: across the 54 prompts in `tests/fixtures/contracts/requests.json` the
  shortest is 24 characters, so the threshold binds on none of them.

**Correction to §1.1 D7:** the table lists `buildEvaluatorPrompt` as referenced by
"its own test only". That was wrong — `scripts/benchmark-prompts.mjs:6` imported
it. The original grep covered only `src/` and `tests/`. It was still deleted, with
its benchmark entry, because the prompt is never sent to a model in production —
but re-grep `scripts/` and `evals/` before trusting any "unreferenced" claim here.

**Not verified — needs a live session:**

- Declining an approval in `pi --spec` (Task 1's manual check).
- A real extraction round-trip. Every test stubs at the model boundary, so no
  contract has been extracted by an actual model. Failure degrades silently to the
  deterministic contract, which is correct but invisible: confirm via `/spec` that
  a real task shows `source: "semantic_extraction"` and non-empty `targets`.

---

**Predecessor:** `docs/plans/2026-07-22-harness-speed-and-spec-gate-fix-plan.md` —
read its §3 principles first. That plan repaired the *contract* plane (W1 advisory
modes, W4.1 `evidenceAnyOf`). This plan repairs the *evidence* plane it feeds.

**Conventions:** TDD (test first, watch it fail, minimal impl, watch it pass,
commit). DRY. YAGNI. One commit per task. Run `bun run typecheck` before each
commit. Tests: `bunx vitest run <path>`. Full suite: `bun run test` — **never**
bare `bun test` (wrong runner, ~26 phantom failures).

---

## 1. Motivation

### 1.1 Verified defects (read against source, 2026-07-26)

**D1 — A rejected spec is restarted by the gate, with permissions restored.**
`governance-hooks.ts:107-111` sets `approvalStatus = "rejected"` and calls
`permissions.remember("*", "*", "deny")`, which pushes a `source: "session"` rule
(`manager.ts:50`). Every tool that turn is denied, so the turn produces no evidence.
`agent_end` verifies anyway; all criteria fail; `shouldReinject` (`gate.ts:17`)
never inspects `approvalStatus`, so it re-injects "The task is not done… Do not stop".
The next turn calls `clearSessionRules()` (`before-agent-start.ts:74`), which drops
exactly the `source: "session"` deny, then skips `startTurn` because the prompt is a
harness continuation (line 77) — so the rejected spec stays active and the agent
retries the refused work, unblocked, up to 3 times.

**D2 — The evidence recognizer cannot see this repo's own test command.**
`classifyTestCommand` (`evidence.ts:41`) accepts a test run only if `argv[0]` is in
`KNOWN_TEST_RUNNERS`, or `argv[0]` is in `KNOWN_RUNNER_BINARIES` **and**
`argv[1] === "test"`.

| Command | Classified | Why |
|---|---|---|
| `vitest run` | test | `argv[0]` is a known runner |
| `bun test` | test | binary + `argv[1] === "test"` |
| **`bun run test`** | **command** | `argv[1]` is `"run"` |
| `npm test` / `pnpm test` / `yarn test` | command | not in either set |
| `npx vitest run` | command | `argv[0]` is `npx` |
| `cd sub && vitest` | command | `argv[0]` is `cd` |

`package.json` defines `"test": "vitest run"` and this project must be run as
`bun run test`. It then fails a second time: `inferExpectedExecutables`
(`task-contract.ts:231`) returns `["vitest","bun test","pytest","jest"]` while
`normalizeExecutable(["bun","run","test"])` yields `"bun"`, so
`executableMatchesExpected` rejects it even as command evidence. **The `build-tests`
criterion (`evidence: ["test"]`) cannot be satisfied on this repo.**

Secondary: the multi-word entries `"cargo test"`, `"go test"`, `"node --test"` in
`KNOWN_TEST_RUNNERS` can never match — `argv[0]` is whitespace-split and cannot
contain a space. They are shadowed by the `KNOWN_RUNNER_BINARIES` branch.

**D3 — Absolute paths silently void diff evidence.** pi's `edit`/`write` schema
declares `path` as "relative or absolute" (`dist/core/tools/edit.js:18`,
`write.js:12`). `pathFromInput` (`evidence.ts:36`) stores it verbatim;
`pathsMatchTargets` (`verification.ts:36`) compares by raw string. An absolute path
matches no repo-relative target, so the diff is filtered out and a gated `diff`
criterion fails. Targets are guaranteed repo-relative by `VALID_TARGET`
(`contract-schema.ts:13`), so the mismatch is entirely on the evidence side.

This is **masked today** — `inferTargets` knows only `auth`, `billing`, `session`, so
`targets` is almost always `[]`, and both matchers short-circuit to `true` on an empty
list. Wiring the extractor (D5) populates targets broadly and un-masks D3 everywhere
at once. **D3 must land before D5 goes live.**

Related tell: `pathFromInput` reads `input.path ?? input.file_path`. `file_path` is
not in pi's schema — it is Claude Code's parameter name. The fallback can only mask a
real schema mismatch.

**D4 — Diff evidence records intent, not outcome.** The live path takes the
`edit`/`write` tool *input* — what the model asked for — and calls it a diff. This
violates predecessor Principle 2 ("the working agent never self-certifies"): a tool
argument is the agent's own claim about its work. Meanwhile `validateDiffEvidence`
(`spec/diff-evidence.ts`, 89 lines) shells out to real `git diff HEAD`, synthesizes
patches for untracked files, extracts actually-changed paths, hashes the patch, and
records the base SHA — and is **referenced by nothing**, no import in `src/`, no test.
Also unpopulated: `TestEvidence.suites` / `.failures` (`claims.ts:23-24`, never
assigned anywhere in `src/`) and `CommandEvidence.family` (hardcoded `""` at
`evidence.ts:95`, though `commandAuditTarget` in `audit/target.ts:56` computes exactly
that value).

**D5 — Semantic extraction is unreachable.** `register-harness.ts:67` is
`new SpecEngine()` with no argument. The constructor's `extractContractCandidate` is
the sole path to `extractTaskContract`'s `extractCandidate`, so `validateTaskContract`
is only ever called on `undefined`, always returns `undefined`, and every spec falls
through to the `buildTaskContract` keyword ladder. `source: "semantic_extraction"` is
unreachable, and all 91 lines of `contract-schema.ts` guard a door nobody walks
through.

**D6 — Three consumers disagree about advisory criteria.** `gate.ts:27` and `:32`
correctly exclude advisory from both re-injection and the continuation prompt. But
`governance-hooks.ts:198` renders a red `✗` for every `!r.passed` including advisory,
`:203` counts them into `hasFailures`, and `:213` titles the panel "Spec Verification
Failed" — so every audit/investigate/catch-all prompt shows a red failure the system
has already decided is non-actionable. `presenters.ts:48` (used by `/spec` and the `e`
shortcut) disagrees with both, rendering a dim `·`. Worst: `governance-hooks.ts:242`
builds `failedCriteria` **unfiltered** and writes a `gate_failure` ledger event
claiming "re-injected N unmet criteria" — but `buildContinuationPrompt` excluded the
advisory ones, so the event asserts something that did not happen. That ledger feeds
the eval bench and generated model profiles.

**D7 — Dead code, one piece of it a trap.** Unreferenced by production (verified by
grepping every `src/` import):

| Symbol | Referenced by |
|---|---|
| `ContinuationArbiter` (`runtime/continuation-arbiter.ts`, 62 lines) | its own test only |
| `buildDefaultFailContract` (`spec/contract.ts:21`, 49 lines) | its own test only |
| `buildEvaluatorPrompt` (`spec/evaluator.ts`, whole module) | its own test only |
| `validateDiffEvidence` (`spec/diff-evidence.ts`) | nothing at all |

`ContinuationArbiter` is the trap: its spec branch reads
`input.results.some((r) => !r.passed)` — **no advisory filter**, where `gate.ts:27`
has one. Promoting it silently reintroduces the loop W1 was written to kill. It also
hardcodes its own `MAX_GATE_ATTEMPTS = 3` beside `gate.ts`'s `GATE_MAX_ATTEMPTS = 3`,
and its `pause_budget`/`turnCount`/`maxTurns` branch duplicates `AutonomyBudget`
(`goal/budget.ts`). `buildDefaultFailContract` shows the decay: its
`/\bdoc|readme|adr|plan\b/` parses as `(\bdoc)|(readme)|(adr)|(plan\b)`, so bare `adr`
matches inside "quadrant"; the live `task-contract.ts:189` has it right.

### 1.2 Why CI is green

`tests/spec/evidence.test.ts` exercises `evidenceFromToolResult` with `vitest run`,
`ls -la`, and `printf test passed` — never `bun run test`.
`tests/spec/verification.test.ts` hand-constructs `EvidenceRecord` literals with clean
repo-relative paths and pre-set `kind` fields — it never feeds a record that
`evidenceFromToolResult` produced. Both units are correct in isolation; **nothing
tests the seam between them**, and D2/D3/D4 all live in that seam. Task 3 closes this
first, so the fixes have a regression net.

---

## 2. Goals / non-goals

**Goals**
- A user's "no" at the approval gate is terminal.
- Evidence reflects what landed on disk and what actually ran.
- The contract extractor is live, with the deterministic ladder as an unconditional floor.
- Panel, prompt, and ledger agree with the gate about what failed.
- `src/spec/` contains no unreachable modules.

**Non-goals**
- No change to the turn lifecycle, continuation-token handshake, or attempt budget.
- No re-litigating W1 advisory modes or W4.1 `evidenceAnyOf` — both stay.
- **No subagent-authored evidence records.** W4.2 deferred these on
  self-certification grounds; Task 6 reaches a child's edits through git ground truth
  instead, which satisfies the outcome without an agent certifying itself. Principle 2
  holds.
- No durable persistence of the session deny (see Task 1 rollback note).

## 3. Inherited principles (from predecessor §3)

1. **Scalpel before switch** — fix matching; never disable reinjection wholesale.
2. **Evidence must mean something** — the working agent never self-certifies.
   `ManualEvidence.actor` stays `user | evaluator`.
3. **Audits are not machine-verifiable** — advisory stays advisory; no cleverer
   matcher that pretends read-telemetry proves findings.
4. **Attribution** — ship behavioral fixes separately from the extractor so a
   regression is attributable.
5. **Escape hatch** — `--spec` and `/goal` keep max thinking and the full hard gate.

---

## 4. Tasks

### Task 1: A rejected spec is terminal (D1)

Ships first: smallest diff, no dependencies, and it is a consent defect.

**Files:**
- Modify: `src/spec/gate.ts`, `src/spec/engine.ts`, `src/runtime/governance-hooks.ts`
- Test: `tests/spec/gate.test.ts`, `tests/spec/engine.test.ts`

**Step 1: Failing tests**

```ts
// tests/spec/gate.test.ts
it("never re-injects when the spec was not approved", () => {
  expect(shouldReinject({
    results: [{ criterion: { id: "c1", statement: "x", evidenceRequired: ["diff"] },
                passed: false, evidence: [], missingEvidence: ["diff"] }],
    attempts: 0, isSubagent: false, enabled: true, goalActive: false,
    specApproved: false,
  })).toBe(false);
});

it("still re-injects for a spec that never needed approval", () => {
  // ambient tier: approvalStatus "not_required" → specApproved true
  expect(shouldReinject({ /* …same, */ specApproved: true })).toBe(true);
});
```

```ts
// tests/spec/engine.test.ts
it("abandons and clears the spec on rejection", () => {
  const spec = new SpecEngine();
  spec.startTurn("add a pagination helper to the billing module", true);
  spec.rejectActiveSpec();
  expect(spec.activeSpec).toBeUndefined();
  expect(spec.verify()).toEqual([]);
});
```

**Step 2: Implement**
- `ReinjectInputs` gains `specApproved: boolean`. Guard it beside `aborted` and
  `goalActive` — the same "a human ended this" family:
  `if (!input.specApproved) return false;`
- `SpecEngine.rejectActiveSpec()`: set `status = "abandoned"`, then `reset()`.
- `governance-hooks.ts:108-111` calls `spec.rejectActiveSpec()` after
  `permissions.remember(...)`. At `agent_end`, pass
  `specApproved: spec.activeSpec === undefined || spec.activeSpec.approvalStatus !== "rejected"`.
  With the spec cleared, `finishTurn` returns `[]`, so the panel block is skipped
  entirely — no wall of red `✗` for criteria the user deliberately prevented.

**Verify:** `bunx vitest run tests/spec/gate.test.ts tests/spec/engine.test.ts`, then
`bun run test`. Manual: `pi --spec`, give a build prompt, decline the approval; the
turn must end silently with no follow-up.

**Rollback:** revert; `specApproved` is additive. Note deliberately out of scope: the
session deny still clears next turn. That is correct once the loop cannot restart the
work — the deny is a turn-scoped stop, not a durable preference. Making it durable is
a separate decision.

---

### Task 2: Delete dead spec code (D7)

Do this before touching the gate further, so there is exactly one continuation
implementation to reason about.

**Files:**
- Delete: `src/runtime/continuation-arbiter.ts`,
  `tests/runtime/continuation-arbiter.integration.test.ts`, `src/spec/evaluator.ts`,
  `tests/spec/evaluator.test.ts`
- Modify: `src/spec/contract.ts` (drop `buildDefaultFailContract`),
  `tests/spec/contract.test.ts`

**Steps:** Confirm zero production importers first —
`grep -rn "ContinuationArbiter\|buildDefaultFailContract\|buildEvaluatorPrompt" src/`
must return only the definitions. Delete. Keep `buildContractFromTaskContract` and
`DefaultFailContract` in `contract.ts` — both are live.

Do **not** delete `diff-evidence.ts`; Task 6 revives it.

**Verify:** `bun run typecheck && bun run lint && bun run test`. `src/spec/` goes
13 modules → 11, all reachable.

**Rollback:** `git revert`. If the arbiter's centralized shape is wanted later, the
correct move is to move `shouldReinject` into it — not to regrow a second
implementation.

---

### Task 3: Seam test — pi-shaped events end to end (closes §1.2)

Regression net for Tasks 4-6. **These tests fail on write and stay failing until
Tasks 4-6 land.** That is intended; run them per-task, not in CI, until Task 6 closes
the last one.

**Files:**
- Create: `tests/spec/evidence-seam.test.ts`

Drive real pi-shaped `tool_result` events through `evidenceFromToolResult` into
`verifyCriteria`, asserting on the `VerificationResult`, never on hand-built records.

Cases to encode:
1. `bash` / `bun run test` against a `build-tests` criterion → **passes** (fails until Task 4).
2. `bash` / `npm test`, `pnpm test`, `npx vitest run`, `cd sub && vitest run` → test evidence.
3. `write` with an **absolute** path under a `src/billing` target → **passes**
   (fails until Task 5).
4. `edit` with `./src/billing/x.ts` and a trailing-slash target → passes.
5. `bash` / `echo done` against a `command` criterion → still rejected
   (`REJECTED_COMMAND_EXECUTABLES`).
6. An advisory `audit-primary` criterion with no matching evidence → `passed: false`,
   `advisory: true`, and `shouldReinject` returns `false`.

Use a real `FormalSpec` built by `generateSpec(...)`, not a literal, so contract
binding is exercised too.

**Verify:** `bunx vitest run tests/spec/evidence-seam.test.ts` — expect cases 1 and 3
red. Commit the red tests with the task, marked in the message.

---

### Task 4: Command normalization (D2)

**Files:**
- Modify: `src/spec/evidence.ts`, `src/spec/task-contract.ts`
- Create: `src/spec/command-normalize.ts`
- Test: `tests/spec/command-normalize.test.ts`, plus seam cases 1-2

**Step 1: Failing tests** — table-driven over the D2 matrix, asserting
`{ kind, runner, normalizedExecutable }`.

**Step 2: Implement** `normalizeCommand(command: string, scripts?: Record<string,string>)`:
1. Split on shell operators with `splitShellClauses` from `audit/target.ts` — already
   imported by `permissions/risk.ts:1`, so this is reuse. Take the last clause with a
   recognizable executable (`cd sub && vitest run` → `vitest run`).
2. Strip leading `env VAR=x`, `npx`, `bunx`.
3. Resolve package-manager indirection: `<npm|pnpm|yarn|bun> run <script>` →
   look `<script>` up in the repo `package.json` `scripts` and recurse on the resolved
   command (depth-capped at 3, cycle-guarded). `bun run test` → `vitest run`.
   `npm test` / `yarn test` are the implicit-`run` form of the same.
4. Return `{ argv, normalizedExecutable, resolvedFrom? }`.

`evidenceFromToolResult` calls it before `classifyTestCommand`/`normalizeExecutable`.
Read `package.json` **once per process**, memoized; on any read/parse failure fall
back to today's behavior — never throw from evidence collection.

Delete the unreachable `"cargo test"`, `"go test"`, `"node --test"` entries from
`KNOWN_TEST_RUNNERS`; the `KNOWN_RUNNER_BINARIES` branch already covers them.

Update `inferExpectedExecutables` to return normalized forms (`["vitest","jest",
"pytest","bun test"]`) so both sides of `executableMatchesExpected` speak the same
vocabulary.

**Verify:** seam cases 1-2 green. `bun run test`.

**Rollback:** revert `command-normalize.ts` and its call site; the rest is additive.

---

### Task 5: Path normalization at record time (D3)

**Files:**
- Modify: `src/spec/evidence.ts`, `src/spec/diff-evidence.ts`
- Test: `tests/spec/evidence.test.ts`, seam cases 3-4

**Step 2: Implement** — in `evidenceFromToolResult`, before constructing
`DiffEvidence`: resolve against `process.cwd()`, convert to repo-relative POSIX,
strip trailing slashes (lift `normalizeClaimedPaths`, `diff-evidence.ts:8`, rather
than rewriting), and **drop** paths that escape the repo root rather than recording
them unmatched. Remove the `input.file_path` fallback — it is not in pi's schema and
can only mask a mismatch.

Record-time (not compare-time) so the canonical path also reaches the audit log and
the harness ledger, and `verifyCriteria` stays a pure string comparison.

**Verify:** seam cases 3-4 green. `bun run test`.

---

### Task 6: Git ground truth for diff evidence (D4)

**Files:**
- Modify: `src/spec/diff-evidence.ts`, `src/spec/engine.ts`,
  `src/runtime/before-agent-start.ts`, `src/runtime/governance-hooks.ts`
- Test: `tests/spec/diff-evidence.test.ts` (new — the module has none today)

**Step 2: Implement**
- **Turn baseline.** `validateDiffEvidence` diffs against `HEAD`, so pre-existing
  uncommitted work counts as this turn's evidence (right now `agent/models-store.json`
  and `benchmark-results.json` are dirty and would satisfy any criterion targeting
  them). At `before_agent_start`, after `spec.startTurn`, capture a baseline: map of
  changed path → content hash. Store on the engine as `turnBaseline`.
- **At `agent_end`**, before `finishTurn`: run `validateDiffEvidence(process.cwd(), …)`,
  drop paths whose hash is unchanged since the baseline, and record the result as the
  authoritative `diff` evidence — replacing tool-input diffs for this turn.
- **Fallback:** if `git` fails or the cwd is not a repo, keep the Task-5-normalized
  tool-input diffs. Never throw from `agent_end`.
- Populate `CommandEvidence.family` from `commandAuditTarget` (`audit/target.ts:56`)
  instead of `""` — `mustNotIsSatisfied` already interpolates the field.
- `TestEvidence.suites`/`.failures`: **delete both fields.** Populating them needs
  per-runner output parsing, which is a larger job with no consumer; declared-but-empty
  optional fields advertise verification depth that does not exist. Revisit with a
  concrete consumer.

Note for reviewers: this reaches a subagent's edits (same working tree) **without**
emitting subagent-authored evidence, so W4.2's deferral and Principle 2 both hold —
git is ground truth, not the agent's claim.

**Verify:** new `diff-evidence.test.ts` covering baseline filtering, untracked files,
non-repo fallback, and escaping paths. Full `bun run test`. Manual: make an edit,
confirm the panel shows the git path; revert the edit before `agent_end` and confirm
the criterion no longer passes.

**Rollback:** the `agent_end` hook is one call; remove it to fall back to tool-input
diffs.

---

### Task 7: Advisory-aware reporting and a truthful ledger (D6)

**Files:**
- Modify: `src/commands/presenters.ts`, `src/runtime/governance-hooks.ts`,
  `src/spec/gate.ts`
- Test: `tests/commands/presenters.test.ts`, `tests/spec/gate.test.ts`

**Step 2: Implement**
- Export the filtered list from `gate.ts` — e.g. `gatedFailures(results)` — and use it
  in **both** `buildContinuationPrompt` and the ledger call, so the two cannot drift.
- `governance-hooks.ts:242`: build `failedCriteria` from `gatedFailures`, not from
  `results.filter((r) => !r.passed)`. The `gate_failure` event must describe what was
  actually re-injected.
- `hasFailures` counts gated criteria only, so the panel says "Failed" only when
  something genuinely blocks.
- Collapse the two renderers: `agent_end` calls `renderSpecVerificationPanel` from
  `presenters.ts` instead of building lines inline. Advisory criteria render as a dim
  `·` with an `advisory` tag; gated failures keep `✗`.

**Verify:** an audit prompt with no command evidence must produce an `info`
notification, no "Failed" title, and **no** `gate_failure` ledger event.
`bun run test`.

---

### Task 8: Promise seam in SpecEngine (D5, part 1)

Behavior-neutral on its own — no extractor is passed yet, so `pendingContract`
resolves `undefined` and the deterministic contract stands. Ship separately per
Principle 4.

**Files:**
- Modify: `src/spec/engine.ts`, `src/spec/generator.ts`, `src/spec/contract-extractor.ts`
- Test: `tests/spec/engine.test.ts`, `tests/spec/contract-extractor.test.ts`

**Step 2: Implement**
- Constructor param becomes
  `extractContractCandidate?: (prompt: string, tier: SpecTier) => Promise<unknown>`.
- `generate()` keeps setting `activeSpec` **synchronously** from `buildTaskContract`
  — the spec is never absent — and stores
  `pendingContract: Promise<TaskContract | undefined>`, resolved through
  `validateTaskContract`, rejecting to `undefined`.
- Add `async settleContract(): Promise<void>` — awaits `pendingContract` and, on a
  valid contract, rebuilds `activeSpec.taskContract` and `acceptanceCriteria` via
  `buildContractFromTaskContract`. Idempotent; safe to call twice.
- Call it at two points: `agent_end` before `finishTurn`, and the explicit-tier
  approval gate before `formatSpecForApproval` — the user must approve the final
  contract, never a deterministic one silently swapped afterward.

**Verify:** existing engine tests stay green unchanged (proves neutrality). New tests:
a resolving extractor upgrades the spec; a rejecting/timing-out one leaves the
deterministic contract intact.

---

### Task 9: Wire the extractor (D5, part 2)

**Files:**
- Create: `src/spec/extractor.ts`, `src/spec/extractor-prompt.ts`
- Modify: `src/runtime/register-harness.ts`, `src/spec/verification.ts`
- Test: `tests/spec/extractor.test.ts`, `tests/spec/verification.test.ts`

**Step 2: Implement**
- Model call mirrors `/goal`'s evaluator exactly: `completeSimple` from
  `@earendil-works/pi-ai/compat`, model via the routing-role pattern
  (`pickEvaluatorModel`) with graceful degradation to the session model, auth via
  `resolveEvaluatorAuth` (`goal/evaluator-model.ts:53`) — **required**, or every
  `models.json`-configured provider fails with "No API key". `reasoning: "low"`.
  Treat `stopReason` `error`/`aborted` as failure (`goal/evaluator.ts:23`).
- Hard `Promise.race` timeout of 10s → `undefined`.
- Prompt asks for a `TaskContract` JSON object: objective plus criteria with
  `targets`, `evidence`, `expectedExecutables`, `expectedArgs`, `mustNot`,
  `verificationMode`. Instruct `source: "semantic_extraction"`. Build it with
  `buildPromptSections` from `prompts/style` for house consistency.
- Output goes through the **existing** `validateTaskContract` untouched — it already
  rejects rather than coerces, which is exactly the trust boundary this needs.
- `register-harness.ts:67` becomes `new SpecEngine(makeContractExtractor(pi))`.
- **Prerequisite, same task — scope `mustNot` before the extractor can populate it.**
  `mustNotIsSatisfied` (`verification.ts:67`) scans *all* recorded evidence rather
  than the criterion's matched evidence, and case-insensitively substring-matches a
  synthesized text blob. It is inert today only because `inferMustNot` emits the
  single literal `"log session tokens"`. The moment this task lands, the extractor
  can emit real `mustNot` values against arbitrary targets — and an unscoped matcher
  will fail criteria on evidence belonging to a *different* criterion. Scope it to
  the matched evidence set computed just above it in `verifyCriteria`, and add tests
  for a genuine violation plus a cross-criterion false positive. This must land in
  the same commit as the extractor wiring, not after it.

Scope: fires on ambient + explicit only. Verified natural rate limit — `classify()`
returns `instant` for short prompts and question-words, and `before-agent-start.ts:77`
skips `startTurn` on both `"spec"` and `"goal"` continuations, so extraction never
fires on gate retries or goal-loop turns. One call per genuine user prompt.

**Verify:** unit tests with a stubbed `complete` (valid contract, malformed JSON,
schema-rejected contract, timeout, auth failure) — every failure path must leave the
deterministic contract standing. Full `bun run test`. Manual: a prompt naming a module
outside `auth|billing|session` must produce non-empty `targets` in `/spec`, with
`source: "semantic_extraction"`.

**Rollback:** revert `register-harness.ts:67` to `new SpecEngine()`. The seam stays;
behavior returns to deterministic-only.

---

### Task 10: Residual cleanup

One commit per bullet.

- **`finishTurn`'s dead branch** (`engine.ts:62-67`) — both arms are
  `return this.verify()`. Remove the `aborted` branch and the unused `_messages`
  param, or make the parameter meaningful. Abort is handled at `gate.ts:19`.
- **`REJECTED_COMMAND_EXECUTABLES`** (`verification.ts:4`) — a four-item denylist
  (`printf`, `echo`, `grep`, `git grep`) where `risk.ts` uses fail-safe allowlisting.
  `ls`, `cat`, and `true` still satisfy a `command` criterion. Invert to an allowlist
  of commands that constitute verification (test runners, build, lint, typecheck),
  reusing `commandAuditTarget`'s family classification.
- **`classify()`'s 20-char threshold** (`engine.ts:16`) — `"fix login bug"` (13 chars)
  gets no spec and no verification at all. Either drop the length rule and rely on the
  question-word prefix test, or lower it to ~10. Needs a judgement call on false
  positives; measure against a prompt sample before changing.

---

## 5. Sequencing

```
Task 1 (consent) ─── independent, ship first
        │
Task 2 (delete dead code) ─── independent
        │
Task 3 (seam tests, red) ──▶ Task 4 (commands) ──▶ Task 5 (paths) ──▶ Task 6 (git truth)
                                                                            │
                                                                      Task 7 (reporting)
                                                                            │
                                                    Task 8 (promise seam) ──▶ Task 9 (extractor)
                                                                            │
                                                                      Task 10 (residuals)
```

**Hard constraints:**
- Tasks 5 and 6 land **before** Task 9. Extraction populates `targets` broadly and
  un-masks D3 everywhere at once.
- Task 8 ships separately from Task 9 (Principle 4 — attribution).
- Task 3's red tests are committed red and must be green by end of Task 6.
- `mustNot` scoping lands **inside** Task 9, in the same commit as the extractor
  wiring. It is inert before Task 9 and wrong immediately after it, so it must never
  be deferred to Task 10 — there is no safe window between them.

## 6. Definition of done

- Declining an approval ends the turn silently; no follow-up, no red panel.
- `bun run test` produces `test`-kind evidence that satisfies a `build-tests` criterion.
- An absolute-path `write` satisfies a criterion targeting that directory.
- Reverting an edit before turn end causes its criterion to fail.
- An audit prompt yields an `info` notification and writes no `gate_failure` event.
- A prompt naming a module outside `auth|billing|session` yields non-empty `targets`
  with `source: "semantic_extraction"`; killing network access still yields a working
  deterministic spec.
- `grep -rn "ContinuationArbiter\|buildDefaultFailContract\|buildEvaluatorPrompt" src/`
  returns nothing.
- `bun run ci` green.
