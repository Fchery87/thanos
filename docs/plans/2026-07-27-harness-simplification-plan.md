# Plan: simplify the harness to a personal daily driver

**Status:** approved · pre-implementation · **Date:** 2026-07-27

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task-by-task.

**Goal:** Stop the harness taxing every ordinary turn, delete the code that no
longer runs, wire the MCP defenses that were written but never called, and replace
three lying instruments with one honest number. The target is a harness that is
lightweight and fast *for one person*, not a team-grade governance product.

**Framing decision (drives everything below):** Thanos is a personal daily driver.
Release is possible but speculative, so release-only costs are not paid now.
`CONTEXT.md` currently defines Thanos around a "Team-grade Governance Layer…
predictable enough for shared team workflows." There is no team. Machinery that
protects the user *from the agent* stays; machinery that coordinates *humans*
goes dormant or goes away.

**Architecture:** No new subsystems. Four kinds of change only — (1) the
continuation gate stops firing on deterministic criteria, (2) the contract
extractor's prompt and schema stop contradicting each other, (3) unreachable
modules and their tests are removed, (4) two written-but-unwired MCP validators
are connected. One new field — `AcceptanceCriterion.source` — carries criterion
provenance to the gate, mirroring how `verificationMode` already reaches it as
`VerificationResult.advisory`.

**Tech Stack:** TypeScript, vitest, bun. Existing modules: `src/spec`,
`src/runtime`, `src/mcp`, `src/agents`, `scripts/`.

---

## Evidence this plan is built on

All figures measured on `restore-pre-sync` at 2026-07-27, not estimated.

| Finding | Measurement |
|---|---|
| Forced continuation turns | 739 `gate_failure` events, 48 today |
| Distinct criteria ever logged | **3** — all deterministic templates |
| Semantic criteria ever produced | **0** (extraction shipped 2026-07-27, 0-for-48) |
| Unreachable source | 31 files / 2,721 LOC (129 of 160 files reachable) |
| Tests bound to unreachable code | ~23 files / ~1,836 LOC |
| Test suite | 118s, 1,154 tests, 148 files |
| Audit log after 669 sessions | 2 rows, both seed data from 2026-05-13 |
| SLO gate cold-load claim vs reality | 32,339ms reported / **1,818ms actual** |
| Per-turn cached prompt overhead | ~840 tok (already lean — not a target) |

**Root cause of 0-for-48, proven by executing the validator:**

```
A) model follows prompt (omits optional fields):  REJECTED
B) same + empty arrays supplied:                  ACCEPTED
C) target "agent/settings.json":                  REJECTED
D) target "src/auth":                             ACCEPTED
```

`extractor-prompt.ts` instructs the model to *"Omit rather than guess"* for
`targets` and *"or omit entirely"* for `expectedExecutables`.
`contract-schema.ts::normalizeCriterion` calls `normalizeStringArray(raw.targets)`,
which returns `undefined` for a missing field, and then rejects the criterion —
and `validateTaskContract` rejects the **whole contract** if any criterion fails.
A model obeying the prompt cannot produce an acceptable contract.

---

## Principles

1. **Every phase ships independently.** No phase depends on a later one.
2. **Measure before and after each deletion.** Suite wall-clock is recorded.
3. **Phase 3 is a real decision gate.** If the extractor still produces nothing
   after repair, `src/spec/` is deleted rather than defended.
4. **Deleting is not the same as disabling.** Nothing is deleted while reachable.

---

## Phase 0 — Stop the 739 (do first, highest daily value)

The gate re-injects a full extra model turn — up to `GATE_MAX_ATTEMPTS = 3` — when
a criterion lacks evidence. Every one of the 739 recorded firings was a generic
template criterion that never described the user's request. This is the single
largest tax on ordinary turns, and it is worth removing whether or not the
semantic path is ever repaired.

**Task 0.1 — Carry criterion provenance to the gate**
- Add `source?: TaskCriterionSource` to `AcceptanceCriterion` (`src/spec/types.ts`).
- Propagate it in `buildContractFromTaskContract` (`src/spec/contract.ts`), which
  currently drops it — mirror how `verificationMode` reaches the gate.
- Surface it on `VerificationResult` in `src/spec/verification.ts`.

**Task 0.2 — Gate only on semantic criteria**
- In `gatedFailures()` (`src/spec/gate.ts`), exclude criteria whose `source` is
  `deterministic_fallback`. Deterministic criteria remain **reported** in the
  turn panel — they are just never allowed to drive a continuation.
- Verification: a spec with only deterministic criteria yields
  `shouldReinject === false`. Add a test asserting exactly this.

**Task 0.3 — Confirm the drop in the field**
- Run normally for one day. `gate_failure` events in
  `.harness/evolution/events.jsonl` should approach zero.
- **Acceptance:** ≤5 gate failures in 24h of normal use (from a 48/day baseline).

---

## Phase 1 — Honest instruments (needed to measure everything after)

Three instruments currently report fiction. They are fixed or deleted *before*
the deletions in Phase 4, so the benefit of those deletions is measurable.

**Task 1.1 — Delete the fabricated eval harness**
- Remove `scripts/eval-prompts.mjs`, `evals/prompts/graders.ts`,
  `evals/prompts/cases.jsonl`, and the `eval:prompts` script in `package.json`.
- Rationale: it calls no model. It emits `ok: true`, `latencyMs: 700 + index*150`,
  `tokenCostUsd: 0.03 + index*0.01`. A model-eval suite is team infrastructure;
  building a real one here would repeat the mistake this plan is undoing.

**Task 1.2 — Delete the line-count benchmarks**
- Remove the `src/index.ts line count` / `import count` / `architectural metrics`
  entries. Measuring file length in milliseconds is not a benchmark.
- **Correction:** these live in `tests/performance/baseline.test.ts:21-41`, not in
  `scripts/benchmark-prompts.mjs` as originally written. That script measures
  prompt sizes deterministically and is left alone.

**Task 1.3 — Fix the SLO gate or delete it**
- `.harness/slo-results.json` reports cold load at 32,339ms against a 10,000ms
  target and has been `passed: false` indefinitely. Actual is ~1,530ms.
- **The defect is worse than recorded here.** The target timed
  `await import("../../src/index")` *from inside vitest*, so it measured the test
  runner's TypeScript transform of the whole module graph. And its only assertion
  was `expect(totalMs).toBeGreaterThan(0)` — it could never fail. The JSON carried
  `passed: false` while `bun run test` stayed green, so the gate was not
  ignored-because-red, it was never read at all.
- Resolution: the target is removed from the vitest file (it cannot be measured
  correctly there) and moved to Task 1.4's script. The four remaining SLO targets
  assert their own thresholds honestly and now report `passed: true`.

**Task 1.4 — Keep exactly one honest number**
- A single measurement of real cold-import time plus per-turn harness overhead,
  recorded before Phase 4 and again after.
- Shipped as `scripts/measure-harness.mjs` (`bun run measure`). Cold import is
  measured in five fresh `bun` processes — the shape pi actually loads in — never
  in-process. `TRUSTED_INSTRUCTIONS` and `SKILLS_DIRECTIVE` are exported from
  `before-agent-start.ts` so the prompt measurement weighs the live directives
  rather than a copy that drifts.

**Recorded baseline — 2026-07-27, before Phase 4:**

```
cold import     1596ms median (1493-1775ms over 5 fresh processes)
turn overhead   ~839 tok cached prefix + ~301 tok per-turn tail
                (of the prefix, ~478 tok is the agent roster)
source          160 files, 16582 lines
```

Independently confirms the ~840 tok/turn figure in the evidence table.

**Not fixed, deliberately:** suite wall-clock is unusable as a gate. Two full runs
on an unchanged tree measured 222s and 294s — 32% variance — against a 118s figure
that does not reproduce. Phase 4 reports it descriptively; nothing gates on it.

---

## Phase 2 — Repair the contract extractor

Do not delete or defend the semantic path until it has had one fair run. These
are the three independent reasons it currently cannot succeed.

**Task 2.1 — Resolve the prompt/schema contradiction**
- In `normalizeCriterion` (`src/spec/contract-schema.ts`), treat a **missing**
  `targets` / `expectedExecutables` / `expectedArgs` / `mustNot` as `[]` rather
  than as invalid. A malformed *present* value must still be rejected — that
  boundary is load-bearing and stays.
- Verification: case (A) from the evidence table above flips to ACCEPTED, and
  every existing malformed-payload rejection test still passes.

**Task 2.2 — Widen `VALID_TARGET`**
- The whitelist admits eight prefixes and rejects `agent/`, `.harness/`, `evals/`,
  and root config files — paths this repo edits constantly.
- Replace the whitelist with a repo-relative check that rejects absolute paths and
  `..` traversal. The regex exists to stop path escape, not to curate directories.
- Verification: case (C) flips to ACCEPTED; `../../etc/passwd` and `/etc/passwd`
  stay REJECTED.

**Task 2.3 — Remove the bail-out instruction**
- `extractor-prompt.ts` tells the model to return `{"objective":"","criteria":[]}`
  when unsure, and `settleContract()` discards empty-objective contracts. The
  prompt invites the failure. Remove the escape hatch; keep the "1–3 criteria,
  smallest set" guidance.

**Task 2.4 — Make the five silent failures observable**
- `ContractExtractor.extract()` has five failure paths — disabled, no model, no
  auth, timeout, unparseable — plus a `catch { return undefined; }`. None log.
  That is why this shipped, ran 48 times, produced nothing, and reported nothing.
- Log each distinctly to the harness ledger. **Fail-safe behaviour is unchanged**
  — extraction failure must still leave the deterministic contract standing.
- Reconsider the 10s timeout once real timing data exists. Do not tune it blind.

---

## Phase 3 — DECISION GATE (blocks Phase 4 for `src/spec/` only)

Run one day with Phase 2 in place, then read the ledger.

- **Extractor produces real, task-specific criteria** → keep `src/spec/`. Phase 0
  now gates on genuine criteria and the subsystem is earning its keep.
- **Still zero after repair** → delete `src/spec/` entirely (~1,800 LOC + tests),
  along with the extractor call on every ambient turn.

**Threshold, pinned before the observation day so it is not decided by vibes:**
**≥50% of ambient turns must yield a validated semantic contract.** Below that,
`src/spec/` is deleted. Measured from the Task 2.4 extraction-outcome log, not
from recollection.

**Why Phases 2–3 were kept rather than collapsed into an immediate deletion:**
Phase 0 added a register()-level test that drives the full pipeline — extract →
validate → build contract → gate — and it passes. The machinery works when the
model returns a well-formed contract. So 0-for-48 is not evidence that the design
fails; it is evidence of the prompt/schema contradiction, which Phase 2 fixes in
a few lines. Repair is cheap and Phase 3 is binding, so the subsystem gets one
fair run before deletion.

This gate is binding. Verifying against git ground truth rather than the model's
self-report is a genuinely good idea and better than what Claude Code or OpenCode
do — but a good idea with a 0% production success rate is not worth a model call
on every prompt.

---

## Phase 4 — Delete unreachable code

29 files / **2,579 LOC** (the 31 unreachable files minus `mcp/trust.ts` and
`mcp/validation.ts`, which Phase 5 wires instead). Verified by reachability trace
from `src/index.ts` and `scripts/thanos-launch.mjs`'s entry into
`src/security/sandbox.ts`.

**Task 4.1 — Orchestration tier (~630 LOC)**
`waves/runtime.ts`, `waves/plan.ts`, `waves/prompt.ts`, `waves/types.ts`,
`waves/verify.ts`, `review/jury-runtime.ts`, `agents/orchestrator.ts`.

`/waves` and `Ctrl+Shift+R` only ever call `buildWavesCommandPrompt` and
`buildJuryPrompt` — both stay. This tier is a second orchestration engine sitting
beside `pi-subagents`, which commit `f8321c8` already chose. Both cannot be right.

**Task 4.2 — Legacy agent spawn machinery (~684 LOC)**
`agents/run.ts`, `agents/run-store.ts`, `agents/process.ts`,
`agents/change-handoff.ts`, `agents/artifacts.ts`, `agents/selector.ts`.

> **Correction carried into this plan:** `agents/task-tool.ts` and
> `agents/catalog.ts` were named as dead during review. They are **reachable**
> and are NOT deleted.

**Task 4.3 — Superseded subsystems (~688 LOC)**
`web/*` (8 files, superseded by `npm:pi-web-access`), `evaluation/runtime.ts`.

**Task 4.4 — Orphans (~354 LOC)**
`goal/budget.ts`, `governance/headless.ts`, `observability/audit-queue.ts`,
`observability/change-manifest.ts`, `prompts/templates/subagent-result.ts`.

**Task 4.6 — DECIDE: `config/resolve.ts` (110 LOC) — delete or wire?**

Shipped 2026-07-23 in `d82d5a5` ("feat(config): single documented resolveConfig
precedence") and **unreachable since the day it landed**. Its plan (Task 11 of
`2026-07-23-thanos-codex-polish.md`) had six steps — write test, verify fail,
implement, verify pass, document, commit — and **no integration step**. It was
never wired because nothing ever asked it to be.

Same class as the MCP modules in Phase 5, so it gets the same explicit decision
rather than a silent deletion:

- **Wire it** if one documented config precedence (env > captain registry >
  untrusted ship-file subset > defaults) is worth having as a single seam.
- **Delete it** if the existing loaders already work and this is consolidation
  nobody asked for.

Default recommendation: **delete.** Unlike `mcp/trust`/`mcp/validation`, nothing
is unsafe without it — the existing loaders are live and correct. But it is the
user's call, not a cleanup decision.

**Task 4.5 — Remove the orphaned tests**
~23 files / ~1,836 LOC match these modules. Each is checked individually before
removal — a file may cover a surviving module too.

**Verification for the whole phase:** `bun run ci` green; suite wall-clock
recorded against the 118s baseline; reachability trace re-run showing 0
unreachable files outside `src/spec/` (pending Phase 3) and the two MCP modules.

---

## Phase 5 — Wire the MCP defenses (security)

`src/mcp/trust.ts` and `src/mcp/validation.ts` have **zero importers**. Written,
tested, never called:

- `evaluateMcpTrust`, `normalizeIdentity`, `environmentAllowlist`
- `validateToolName`, `validateToolCount`, `validateToolDescription`,
  `validateResultSize`, `validateFrameSize`, `validateToolResultSize`

Commit `815a88b` closed "the MCP silent-allow hole" by classifying unrecognized
tools as high-risk. These look like the deeper defense meant to sit behind it.

**Task 5.1** — Wire `validation.ts` into the MCP tool-registration path
(`src/mcp/manager.ts` / `lifecycle.ts`): reject malformed tool names, enforce
result/frame size caps.

**Task 5.2** — Wire `evaluateMcpTrust` into server connection, so an untrusted
server is gated rather than silently connected.

**Task 5.3** — Verify with a hostile-server test: oversized results, malformed
tool names, and an untrusted identity are each refused.

---

## Phase 6 — Make the documents tell the truth

**Task 6.1 — `CONTEXT.md`**
Remove the "Team-grade Governance Layer" definition and the "shared team
workflows" framing. Thanos is a single-operator harness. Retire glossary entries
for concepts deleted in Phase 4 (**WAVES Orchestration**, **Review Jury** as a
runtime). Keep it a glossary — no implementation detail.

**Task 6.2 — `AGENTS.md`**
Drop references to removed commands and flows.

**Task 6.3 — Supersede the affected ADRs (do not orphan them)**

`docs/adr/` is the durable decision layer and must not be left describing code
that no longer exists.

- **ADR 0006 `completion-verification-gate`** — if Phase 3 deletes `src/spec/`,
  write a successor ADR recording *why* (0-for-48 after repair; the deterministic
  path produced 739 false continuations and zero true positives) and mark 0006
  superseded. If Phase 3 keeps `src/spec/`, amend 0006 to state that only
  `semantic_extraction` criteria gate.
- **ADR 0007 `goal-loop-single-driver`** — verify it still holds after Phase 0.
  It should: the gate already defers to an active goal (`gate.ts:45`), and
  Phase 0 only narrows what the gate acts on.
- Check the remaining six ADRs against the Phase 4 deletions — notably any that
  reference the orchestration tier.

**Task 6.4 — Stop plan docs accumulating again**

`docs/plans/` reached 19,099 lines — larger than `src/` — while `AGENTS.md`
directs re-entry to "the active plan doc" with no way to tell which is active.
Pruned to 6 live plans on 2026-07-27 (27 files / 17,013 lines removed; git
retains them via `git show HEAD~1:docs/plans/<name>`).

Convention going forward:
- Every plan opens with a `**Status:**` line.
- `docs/plans/` holds **live plans only**. A completed plan is deleted on
  completion, not archived in place — its durable content belongs in an ADR.

**Task 6.5 — Mark the dormant tier honestly**
`audit/` and `policy/` stay wired but are documented as **dormant-by-design**: the
audit log holds 2 seed rows after 669 sessions, and policy presets are never
switched by a single operator. They cost no turn latency and are the only bridge
to a future release story — but they should not read as live infrastructure.

---

## What is deliberately NOT being done

- **No new orchestration.** `pi-subagents` handles delegation; 506 runs in
  `run-history.jsonl` say it works.
- **No real eval harness.** That is the trap this plan exists to escape.
- **No context-management work.** Pi already does read caps, pagination,
  tool-result caps, subagent isolation, and threshold compaction.
- **No feature-parity chase against Claude Code / Codex / OpenCode / Goose.**
  Most of that surface is Pi's, not Thanos's.
- **No prompt-overhead work.** ~840 cached tokens/turn is already lean.

---

## Expected outcome

| Metric | Now | After |
|---|---|---|
| `src/` LOC | 16,375 | ~13,800 (~12,000 if Phase 3 deletes `src/spec/`) |
| Unreachable files | 31 | 0 |
| Forced continuation turns/day | ~48 | ≤5 |
| Model calls per ordinary turn | up to 4 | 1 (2 if the extractor is kept) |
| Lying instruments | 3 | 0 |
| Unwired security modules | 2 | 0 |
| Test suite | 118s | measured after Phase 4 |
