# Spec: Delegation budget defects — dead frontmatter keys, a validator that only knew the dead keys, and a timeout misclassified as retryable

## Metadata

| Field | Value |
| --- | --- |
| Author | Claude (this repo has no established `Author:` convention on ADRs or prior specs — `docs/adr/*.md` records only `**Status:**`, no attribution field. Only the first of the six underlying commits, `c0fdb07`, carries a `Co-Authored-By: Claude Sonnet 5` trailer — the rest deliberately don't, once this work established that this repo's own convention on recent commits carries no such trailer. "Claude" here just names who's writing this backfill, not a repo-wide attribution pattern.) |
| Status | Implemented, PR open — not yet merged to `master`. All five commits below are on `fix/delegation-budget-defects` (PR #65, https://github.com/Fchery87/thanos/pull/65, state `OPEN`), blocked from merging by an active GitHub-wide Actions outage unrelated to this change, not by anything in the diff. |
| Created | 2026-08-06 |
| Last updated | 2026-08-06 |
| Tracking issue/PR | https://github.com/Fchery87/thanos/pull/65 |
| Compatibility posture | Clean break, see below |

**This document is a retroactive backfill, not a forward-looking spec.** The
template's own opening line says "a spec is written *before* the change";
this one is written after. It exists specifically as Task 1.2 of
`docs/plans/2026-08-06-atomic-derived-hardening-plan.md` (Phase 1, "Backfill
one spec retroactively") — the check that Task 1.1's new `docs/specs/`
template actually survives contact with a real change, not just a
hypothetical one. Every section below is written honestly for that fact: it
describes decisions already made and code already committed on
`fix/delegation-budget-defects` (PR #65, not yet merged), not proposals
awaiting review. Where the
template's phrasing assumes forward motion ("Run: ... Expected: PASS"), this
document reports what happened instead.

**Compatibility posture.** Clean break on two fronts, both deliberate:

1. **Frontmatter keys.** `maxExecutionTimeMs` and `maxTurns` are not
   silently accepted, aliased, or deprecation-warned — they are rejected
   outright at validation time (`src/agents/manifest.ts`, commit `6a9421a`):
   `throw new Error(`${role}: ${retired} is retired; use ${live} (...)`)`.
   No shim keeps the old keys working alongside the new ones, even
   temporarily. That is deliberate: a silent-ignore shim (accept the old
   key, do nothing with it) is exactly the bug this spec fixes — every one
   of the 13 profiles had been doing that unintentionally against
   `pi-subagents` 0.41.0 itself, with no error anywhere, for an unknown
   length of time. Reproducing that shape on purpose, even as a courtesy
   migration path, would recreate the failure mode under a different name.
   There was no external consumer of the old keys to break — they were
   already inert — so a clean break costs nothing a shim would have saved.
2. **Timeout classification.** The `isRetryableModelFailure` patch
   (`3dea97e`) changes behavior for every existing subagent call site with
   no opt-out: a subagent wall-clock timeout stops advancing the model
   fallback ladder, unconditionally. This is also a clean break rather than
   a flag-gated change, because the old behavior (re-run the whole task on
   the next model after a timeout) was never intentional — it was an
   unnoticed pattern-match collision, not a designed retry policy anyone
   was relying on.

Nothing about the numeric budget *values* changed — see The problem and
Deletion inventory. This spec's clean break is about which key names and
which failure classifications are accepted, not about what any agent's
actual timeout or turn count is.

## Executive summary

Three real defects in the subagent delegation budget path were found and
fixed on `fix/delegation-budget-defects` (PR #65): every agent's declared
`maxExecutionTimeMs`/`maxTurns` frontmatter was silently unread by the
installed `pi-subagents` 0.41.0, the TypeScript validator only knew about
those same dead keys, and a subagent's own timeout was misclassified as a
retryable model failure — causing the fallback ladder to re-run an entire
task instead of accepting that the child had simply run out of its declared
budget. All three are fixed: frontmatter moved to the live `timeoutMs`/
`turnBudget` keys (values preserved byte-for-byte), the validator now
rejects the retired keys loudly instead of accepting them silently, and the
timeout misclassification is patched via this repo's vendored-patch
mechanism with a behavior verifier that actually imports the patched code.

## Context and motivation

This work was discovered while reviewing `bastani-inc/atomic` against this
repo's `pi-subagents` fork — a comparison review, not a planned audit of the
delegation path. The review surfaced that Atomic's fork reads different
frontmatter keys than the ones this repo's 13 agent profiles declare, which
led to checking what `pi-subagents` 0.41.0 (the version actually installed
here) reads versus what this repo assumed it read.

The resulting work was broken into a task-by-task plan,
`docs/plans/2026-08-06-atomic-derived-hardening-plan.md`. That plan is
**not deleted** — per `AGENTS.md` § Plan Documents, a plan is deleted only
on completion, and this plan's Phase 2 (structured outputs), Phase 3
(evidence-shaped roster), and Phase 4 (vendor decision ADR) are still
pending. It is, however, unreachable from this branch (`docs/spec-discipline-scaffold`)
and from `master`: it lives only on the unmerged `fix/delegation-budget-defects`
branch (PR #65), so citing its content here means citing it the same way
this template tells you to cite a *deleted* plan — `git show
<commit>:docs/plans/<name>`, e.g. `git show d1c63c6:docs/plans/2026-08-06-atomic-derived-hardening-plan.md`
for the plan as originally written, or `git show 3eef8d6:docs/plans/2026-08-06-atomic-derived-hardening-plan.md`
for the version after a self-correction (see Non-goals). This spec covers
only Phase 0 of that plan — the two confirmed budget defects plus the
timeout-classification bug that Phase 0's own investigation surfaced
alongside them. Task 1.2 of the same plan is this document.

No `docs/adr/` entry precedes this change; no prior ADR needed revisiting or
extending to make it. No `docs/research/` directory exists in this repo.

## Current state

Before this change, on `feat/pi-subagents-0.41.0-migration` (the base this
work branched from):

- All 13 profiles in `agent/agents/*.md` declared `maxExecutionTimeMs`
  (13/13) and most declared `maxTurns` (11/13 — `scout.md` and `worker.md`
  never declared a turn budget). Neither key is read anywhere in the
  installed `pi-subagents` 0.41.0's frontmatter parser
  (`src/agents/agents.ts`); every agent silently ran on the runtime's
  `DEFAULT_FOREGROUND_TIMEOUT_MS` (30 minutes) with no turn budget at all,
  regardless of the 10–20 minute figures each profile's frontmatter
  claimed.
- `src/agents/manifest.ts` validated `maxExecutionTimeMs` was a positive
  number (previously: `if (manifest.maxExecutionTimeMs !== undefined &&
  manifest.maxExecutionTimeMs <= 0) throw ...`) and had no knowledge of
  `timeoutMs` or `turnBudget` at all. `src/agents/loader.ts` parsed
  `maxExecutionTimeMs`/`maxTurns` from frontmatter and nothing else in this
  space.
- `src/runtime/before-agent-start.ts` told the parent model, in a trusted
  instruction string: *"every agent has its own maxExecutionTimeMs
  budget"* — naming the exact field that did nothing.
- `pi-subagents`' `isRetryableModelFailure` (in `runs/shared/model-fallback.ts`)
  matched the string `"Subagent timed out after Nms."` (the message
  `formatTimeoutMessage` emits on a wall-clock timeout) against its
  `RETRYABLE_MODEL_FAILURE_PATTERNS`, which include `/timed? out/i` and
  `/timeout/i`, with only a `TOOL_FAILURE_PREFIX` guard that does not cover
  this shape.

## The problem

**Defect 1 — two of the three declared budget keys were dead.** Confirmed
by pinning the actual frontmatter key set `pi-subagents` 0.41.0 reads
(`tests/agents/frontmatter-keys.test.ts`, commit `c0fdb07`): `timeoutMs` and
`turnBudget` are read; `maxExecutionTimeMs`, `maxTurns`, and `maxTokens` are
not. Every one of the 13 profiles in `agent/agents/*.md` had been declaring
at least one dead key with no error, no warning, and no test catching it —
the suite was green over fields that did nothing.

**Defect 2 — the validator and loader only knew about the dead keys.**
`src/agents/manifest.ts` and `src/agents/loader.ts` typed and validated
`maxExecutionTimeMs`/`maxTurns` as the real budget fields. A manifest that
declared the live `timeoutMs`/`turnBudget` keys instead would have passed
through unvalidated (no positive-number check, no JSON-shape check on
`turnBudget`), and a manifest still declaring the dead keys would keep
passing validation forever with no signal that the value bound to nothing
at runtime.

**Defect 3 — a subagent's own timeout was misclassified as a retryable
model failure.** `formatTimeoutMessage` in `pi-subagents`' execution path
emits `"Subagent timed out after ${timeoutMs}ms."` on a wall-clock timeout.
`isRetryableModelFailure` in `runs/shared/model-fallback.ts` matches this
string against `RETRYABLE_MODEL_FAILURE_PATTERNS`, which includes
`/timed? out/i`; the function's only exclusion guard,
`TOOL_FAILURE_PREFIX`, matches a different message shape
(`` `<tool> failed (exit N)` ``) and does not exclude this one. The result:
when a subagent legitimately exhausts its own declared `timeoutMs` budget,
the caller's model-attempts loop treats that exhaustion as evidence the
*model* failed, advances to the next model in the fallback ladder, and
re-runs the entire task from scratch — burning the time already spent and
producing no better outcome, since no other model fixes a budget the child
ran out of. Defect 1 made this worse in practice: agents were getting 30
minutes instead of their declared 10–20, so a run burned 30 minutes before
hitting this misclassification and re-running.

## Goals

- [x] Every agent profile in `agent/agents/*.md` declares its time and turn
      budgets under keys `pi-subagents` 0.41.0 actually reads — verified by
      `tests/agents/frontmatter-keys.test.ts` (pins the live key set) and
      `tests/agents/roster-contract.test.ts` (asserts every profile uses
      them).
- [x] `src/agents/manifest.ts` and `src/agents/loader.ts` reject
      `maxExecutionTimeMs`/`maxTurns` with a loud, specific error rather
      than silently accepting and ignoring them — verified by
      `tests/agents/manifest.test.ts`'s retired-key rejection tests.
- [x] No trusted system-prompt instruction names a budget field
      `pi-subagents` does not read — verified by
      `tests/prompt-system/instruction-surface.test.ts`'s
      "does not promise a delegation budget field pi-subagents does not
      read" test.
- [x] A subagent's own wall-clock timeout is not classified as a retryable
      model failure, while a genuine upstream/provider timeout still is —
      verified by `tests/delegation/timeout-classification.test.ts` (two
      cases: `"Subagent timed out after 1800000ms."` → not retryable;
      `"upstream request timeout"` and `"504 Gateway Timeout"` → still
      retryable) and by `scripts/patch-pi-subagents.mjs`'s
      `verifyTimeoutClassification()`, which imports the live patched
      runtime module and checks both directions at session start.

## Non-goals

- [ ] **NOT vendoring `pi-subagents`.** The timeout-classification fix
      stays a patch hunk in `scripts/patches/pi-subagents-0.41.0-evidence.patch`,
      not a fork. This is Phase 0 of a larger plan whose Phase 4 records the
      vendor-vs-patch decision itself, with explicit tripwires (patch
      artifact exceeds 4 hunks; a hunk fails to forward-port and its
      verifier reports `broken`; a defect surfaces that can't be expressed
      as a patch at all) — see
      `git show d1c63c6:docs/plans/2026-08-06-atomic-derived-hardening-plan.md`
      (Phase 4, "Vendor decision record"). That ADR (planned as
      `docs/adr/0024-...`) has not been written yet; this spec does not
      write it, since Phase 4 is unstarted.
- [ ] **NOT re-tuning the declared budget values.** The originating plan
      task states the constraint directly: "Preserve the declared values —
      this task fixes the key, not the budget. Re-tuning belongs in a
      separate change with measurement behind it." (`git show
      d1c63c6:docs/plans/2026-08-06-atomic-derived-hardening-plan.md:178` —
      commit `7dddbe1`'s own message states the same substance more
      tersely, without this direct wording.) Every profile's numeric budget
      carried over unchanged — `build.md` and `designer.md` stayed at 40
      turns / 1,200,000ms, `explore.md` stayed at 20 turns / 600,000ms,
      `scout.md` stayed at 600,000ms with no turn budget, `worker.md`
      stayed at 1,200,000ms with no turn budget (neither ever declared
      `maxTurns`, so neither gained a fabricated `turnBudget` — verified in
      the `7dddbe1` diff, which touches `scout.md`/`worker.md` for
      `timeoutMs` only, one line each).
- [ ] **NOT fixing the two unrelated pre-existing test failures.** The PR
      description for #65 records a full-suite run of 1236 passed, 2
      failed, with the 2 failures identified as a pre-existing
      `tests/runtime/register-harness.smoke.test.ts` baseline confirmed
      (via a detached worktree at a commit predating this branch) to exist
      before this branch's work started. Fixing them was out of scope for
      a budget-path defect fix.
- [ ] **NOT adopting structured outputs, reshaping the specialist roster,
      or writing the Phase 4 vendor ADR in this change.** All three are
      later, independent phases of the same originating plan (Phases 2, 3,
      and 4 respectively) — sequenced after Phase 0 deliberately, since
      Phase 2 depends on budgets being real before runs can be measured
      against them, and Phase 3 depends on Phase 2's structured outputs to
      make angle-specific reviewers composable. Folding them into this
      change would have coupled an urgent defect fix to unrelated,
      lower-urgency design work.

## Proposed solution

| Component | Change | File(s) |
| --- | --- | --- |
| Regression-guard test | New test enumerates every `frontmatter.<key>` reference in `pi-subagents`' own `agents.ts` and pins that `timeoutMs`/`turnBudget`/`maxSubagentDepth` are read while `maxExecutionTimeMs`/`maxTurns`/`maxTokens` are not — fails loudly on a future upstream rename instead of silently reintroducing this bug | `tests/agents/frontmatter-keys.test.ts` (commit `c0fdb07`) |
| Agent frontmatter | All 13 profiles migrated: `maxExecutionTimeMs: N` → `timeoutMs: N` (plain integer, unchanged); `maxTurns: N` → `turnBudget: {"maxTurns": N}` (JSON object string, since `pi-subagents` JSON-parses this key into `{maxTurns, graceTurns?}`) | `agent/agents/*.md` (commit `7dddbe1`) |
| Manifest validator | `AgentManifest` interface gains `timeoutMs`/`turnBudget` as the real fields; `maxExecutionTimeMs`/`maxTurns` stay typed (as `@deprecated`) only so a `RETIRED` lookup table can reject either outright with a "retired; use X" error instead of silently accepting them; `turnBudget.maxTurns` is checked as a positive integer (tightened further in the same-day follow-up `9d222d8` after code-quality review caught `4.5` slipping past a bare `<= 0` check) | `src/agents/manifest.ts`, `src/agents/loader.ts` (commit `6a9421a`, refined by `9d222d8`) |
| System prompt | Trusted instruction string corrected from `"every agent has its own maxExecutionTimeMs budget"` to `"every agent has its own timeoutMs budget"` | `src/runtime/before-agent-start.ts` (commit `bebe0db`) |
| Timeout classification patch | New hunk in the evidence patch adds a `SUBAGENT_TIMEOUT_PREFIX` regex guard to `isRetryableModelFailure`, mirroring the file's existing `TOOL_FAILURE_PREFIX` guard pattern, so a subagent's own timeout message is excluded before the general `/timed? out/i` pattern gets a chance to match; registered in both `PATCH_MARKERS` (manual apply/verify) and `PATCH_TARGETS` (session-start self-heal drift detection); a new `verifyTimeoutClassification()` behavior verifier actually imports the live patched `model-fallback.ts` and asserts both directions (subagent timeout → not retryable; provider timeout → still retryable) rather than checking a string marker | `scripts/patch-pi-subagents.mjs`, `scripts/patches/pi-subagents-0.41.0-evidence.patch`, `src/welcome/patch-drift.ts` (commit `3dea97e`) |

## Deletion inventory

| Item | Type | Disposition |
| --- | --- | --- |
| `maxExecutionTimeMs` frontmatter key (13/13 profiles in `agent/agents/*.md`) | config | **Retired**, not renamed-with-shim — `timeoutMs` is a distinct key the validator now requires; the old key is rejected outright if present |
| `maxTurns` frontmatter key (11/13 profiles) | config | **Retired**, not renamed-with-shim — `turnBudget` is a distinct key with a different shape (JSON object, not a plain integer); the old key is rejected outright if present |
| `AgentManifest.maxExecutionTimeMs`/`maxTurns` positive-number validation branch | code | **Superseded** by the `RETIRED` rejection table in `src/agents/manifest.ts` — the old branch validated a field that did nothing; the new one exists solely to reject that field loudly |
| `"every agent has its own maxExecutionTimeMs budget"` instruction string | doc (trusted system prompt) | **Retired** — replaced with the accurate `timeoutMs` claim; the old sentence is not preserved anywhere, including as a comment, since it was actively false |
| `pi-subagents`' unpatched `isRetryableModelFailure` classification of `"Subagent timed out after Nms."` as retryable | behavior | **Superseded** by the patched version (`SUBAGENT_TIMEOUT_PREFIX` guard) for as long as the patch applies cleanly; this is a behavior retirement, not a code deletion, since the underlying dependency is not owned by this repo (see Non-goals) |

## Risks

- **Upstream renames `timeoutMs`/`turnBudget` in a future `pi-subagents`
  release**, silently recreating Defect 1 under new names. Detection
  signal: `tests/agents/frontmatter-keys.test.ts` (commit `c0fdb07`) reads
  the installed package's own `agents.ts` source at test time rather than
  hardcoding an assumption, so a rename fails this test immediately on the
  next `bun run test` after the dependency bump — before any agent profile
  needs to change.
- **The timeout-classification patch hunk stops applying cleanly on a
  future `pi-subagents` upgrade** (e.g. if `model-fallback.ts` is
  restructured or `RETRYABLE_MODEL_FAILURE_PATTERNS` moves). Detection
  signal: `scripts/patch-pi-subagents.mjs`'s `verifyTimeoutClassification()`
  imports the live patched module and asserts actual behavior, not just
  that a string marker is present in the file; it runs at session start via
  the self-heal mechanism (`src/welcome/patch-drift.ts`'s `PATCH_TARGETS`,
  extended in `3dea97e` to include this hunk), so drift is caught the next
  time a session starts, not discovered later at incident time.
- **A future contributor reintroduces `maxExecutionTimeMs`/`maxTurns` in a
  new agent profile**, expecting them to work by analogy with older
  documentation, examples, or muscle memory. Detection signal:
  `src/agents/manifest.ts`'s `RETIRED` table throws immediately at
  validation time with a message naming the correct replacement key, so
  this fails at authoring time rather than silently at runtime.
- **This spec's own Non-goals list undersells scope**: three defects were
  fixed together because Defect 3's investigation surfaced directly out of
  fixing Defects 1 and 2 (see The problem — Defect 1 made Defect 3 worse in
  practice, and both trace to the same `pi-subagents` frontmatter/error
  contract). A reader treating this as three unrelated changes bundled
  together would miss that connection; it is stated here explicitly to
  close that gap.

## Rollout

Implemented directly as five commits (`c0fdb07`, `7dddbe1`, `6a9421a`,
`bebe0db`, `3dea97e`), each test-first and independently spec- and
code-quality-reviewed by fresh subagents against the actual diff — not the
implementer's self-report — per this repo's subagent-driven development
practice. One review caught a real gap and produced a same-day follow-up
commit (`9d222d8`, tightening `turnBudget.maxTurns` to require an integer
after the review found `4.5` slipping past a bare `<= 0` check), and a
separate self-correction (`3eef8d6`) fixed a contradiction in the plan
document itself (an earlier draft of the roster-contract test would have
required every agent to declare a turn budget, which was wrong for
`scout`/`worker`, which never had one). No separate `docs/plans/` breakdown
was needed for *this* spec's own rollout, because the task-by-task
breakdown already existed — this work executed Phase 0 of
`docs/plans/2026-08-06-atomic-derived-hardening-plan.md` (see Context and
motivation) rather than originating its own plan. No new ADR was written as
part of this change; the one irreversible-decision candidate this work
surfaces (vendor `pi-subagents` vs. keep patching) is deliberately deferred
to that same plan's Phase 4, not decided here (see Non-goals).

**Worth stating plainly**: this Rollout section describes work that already
happened, in the order it happened, including the review finding that
produced `9d222d8` — this document was not available to guide that work,
since it is being written after the fact as Task 1.2 of the same plan
(Phase 1). A spec written before this change would have listed these five
commits as a proposed sequence with a review gate between each; this one
lists them as a completed sequence with the review gate's actual output
folded in.
