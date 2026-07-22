# Plan: repair the impossible spec gate and give ordinary prompts a fast lane

**Status:** W1 + W2 landed, W3 resolved, W4.1 landed (4.2 deferred) · **Date:**
2026-07-22 · **Branch:**
`fix/spec-gate-audit-fast-lane` · **Scope:** SpecEngine contract correctness +
default-path latency. Governance policy computation is already fast (sub-ms);
this plan targets *workflow amplification*, not the policy engine.

**Progress:** W1 (§4) implemented — audit/investigate/catch-all criteria are now
advisory, the impossible `manual` requirement and `["bash"]` matcher are gone,
`build-docs` requires `diff` not `manual`. Regression tests pin both directions.
Full suite green (979 tests). W0 baseline capture is deferred to the W2
checkpoint, where it serves as the before/after anchor for the speed knobs.

## 1. Motivation

Thanos is tuned like an assurance pipeline for every prompt. Two verified
correctness defects and four default-path settings compound multiplicatively, so
a one-line change pays the same tax as a risky refactor. The goal is Thanos-grade
intelligence on demand, Claude-Code-grade responsiveness by default.

### 1.1 Verified defects (read against source)

**Defect A — audit/investigate specs are unsatisfiable, forcing 4 model turns.**
- `src/spec/task-contract.ts:67` — an `audit` prompt requires evidence
  `["manual", "command"]` (`investigate` at `:50` mirrors it). Verification is
  purely conjunctive (AND) in `src/spec/verification.ts:118`.
- `src/spec/evidence.ts:72` — the runtime collector `evidenceFromToolResult`
  only ever emits `test | command | diff`. **Never `manual`.**
- `src/spec/claims.ts:37` — `ManualEvidence.actor` is `"user" | "evaluator"`;
  the working agent structurally *cannot* emit `manual` evidence.
- `src/spec/gate.ts:15` — with no `/goal` active (no evaluator), the `manual`
  requirement is permanently unmet, so `shouldReinject` stays true until
  `GATE_MAX_ATTEMPTS` (3) → **4 total turns** before giving up.

**Defect B — even the `command` half can never match (independent of A).**
- `src/spec/task-contract.ts:195` — audit/investigate set
  `expectedExecutables: ["bash"]`.
- `src/spec/evidence.ts` `normalizeExecutable` returns `argv[0]` — the real
  program (`git`, `rg`, `bun`, `ls`), never the literal string `"bash"`.
- `src/spec/verification.ts:40-42` — `executableMatchesExpected` requires an
  **exact** `includes` match. `["bash"]` is a value outside the collector's
  range, so `command` evidence never matches for any normal audit command.

**Consequence:** dropping `manual` alone is insufficient — the `["bash"]`
matcher independently blocks the `command` half. Both cuts are required. And
fixing the contract *without* moving audits to advisory only flips the bug from a
**false negative** (never passes) to a **false positive** (any stray `ls`
passes). The contract fix and the advisory policy are therefore **one atomic
change**, not two steps.

### 1.2 Default-path settings (verified in `agent/settings.json`)

- `defaultThinkingLevel: "max"` — max reasoning on trivial work.
- `goal.maxTurns: 200` — no meaningful autonomous ceiling.
- `register-harness.ts:1640` — hard directive to "PROACTIVELY delegate" ordinary
  non-trivial work; `:1656-1658` compounds it ("load the skill *and* delegate").
- `subagents.modelOverridesEnabled: false` — the mini/low routes for
  explore/scout/evaluator are dead config; routing was disabled on purpose.

## 2. Goals / non-goals

**Goals**
- Ordinary read-only/reporting prompts return inline, advisory-verified, no
  continuation loop.
- The genuinely useful "tests are red, keep working" reinjection survives for
  mutating tasks.
- Medium thinking + inline-first by default; max thinking + hard gate reachable
  on explicit `--spec` / `/goal`.
- Every change is measured before/after and independently reversible.

**Non-goals**
- No rewrite of the governance/risk engine (already fast).
- No broadening of `ManualEvidence.actor` to `"agent"` (see §4, W1).
- No bundling of model-provider routing with latency knobs (see §4, W3).

## 3. Principles that constrain the design

1. **Scalpel before switch.** Fix the impossible contract; do not disable
   reinjection wholesale.
2. **Evidence must mean something.** The working agent never self-certifies.
   `actor` stays `user | evaluator`.
3. **Audits are not machine-verifiable.** An open-ended audit's *correctness*
   cannot be proven from tool telemetry. Audits go advisory; they do not get a
   cleverer evidence matcher that pretends read-telemetry verifies findings.
4. **Attribution.** Ship latency knobs on the *same* models together; keep the
   model-provider swap (routing) as its own measured experiment.
5. **Escape hatch.** `--spec` and `/goal` must still reach max thinking + the
   full hard gate on demand.

## 4. Workstreams (in rollout order)

### W0 — Baseline instrumentation (do first, changes no behavior)

Establish before/after signals so W1/W2 are measurable, not vibes.

- **0.1** Emit/record four metrics per top-level turn: `prompt→first-tool`,
  `prompt→final`, `continuation-turn count`, `child count + duration`. Reuse the
  existing SLO artifact path (`.harness/slo-results.json`) where possible.
- **0.2** Capture a baseline run set: the exact audit prompt
  ("do an honest audit …"), a trivial single-file edit, and a real
  build-with-failing-test. Store under `.harness/` as the comparison anchor.
- **Verify:** baseline numbers written; no source behavior changed.
- **Rollback:** metrics are additive; remove the emitter.

### W1 — Repair the impossible contract + audit-advisory (ATOMIC)

All of W1 lands as a single reviewable change; partial landing is worse than none.

- **1.1** `src/spec/task-contract.ts:191-197` — `inferExpectedExecutables`:
  audit/investigate return `[]` (accept any command), not `["bash"]`. Do **not**
  invent a "correct" executable — audits are open-ended.
- **1.2** `src/spec/task-contract.ts:50,67` — drop `manual` from the
  audit/investigate deterministic-fallback `evidence` arrays.
- **1.3** Make audit/investigate criteria **advisory**: they surface findings but
  do not drive reinjection. Preferred mechanism: a `verificationMode:
  "advisory" | "gated"` marker on the criterion/contract, consumed in
  `src/spec/gate.ts` `shouldReinject` (advisory criteria never reinject) and
  rendered as informational in the turn summary.
- **1.4** Leave `src/spec/claims.ts:37` `ManualEvidence.actor` **unchanged**
  (`user | evaluator`). Add a code comment recording *why* (self-certification).
- **1.5** Regression tests (both directions, non-negotiable):
  - the exact audit prompt → resolves advisory/passing in **one** turn, **zero**
    continuations;
  - a mutating task with a red test → **still reinjects** on the failing
    `test`/`diff` criterion.
- **Verify:** `bun run typecheck`; the two regression tests; re-run W0.2 audit
  baseline shows 1 turn, 0 continuations.
- **Risk:** advisory marker leaks into gated paths and weakens a real gate.
  Mitigated by the second regression test.
- **Rollback:** revert the single change; contract returns to prior (broken but
  known) state.

### W2 — Default-path speed bundle (ship together; NO routing)

**Checkpoint state (2026-07-22): W2 applied.**
- **2.3 inline-first directive — DONE + committed** (`80c3256`, branch code,
  `register-harness.ts`). Live after the next harness build/reload. No test pinned
  the old text; suite green.
- **2.1 / 2.2 — APPLIED to live config** (`agent/settings.json`, gitignored;
  backup at `agent/settings.json.bak-pre-w2-*`). `defaultThinkingLevel: "max" →
  "medium"`; `goal.maxTurns: 200 → 25` (code default was already 25; escape hatch
  `GoalBudget.extend()`). Active on the next `pi` session. Formal before/after was
  deferred by decision — these are one-line reversible knobs; measurement rigor is
  reserved for W3 routing and a holistic felt-speed check.
  Revert: `cp agent/settings.json.bak-pre-w2-* agent/settings.json`.

**W0 baseline procedure (user-run — needs live model turns, cannot be faked):**
On the *current* config (max thinking, pre-2.3 build), run the three canonical
prompts and record wall-clock + child metrics, then apply 2.1/2.2 + the 2.3 build
and re-run the same three:
1. the exact audit prompt ("do an honest audit …") — expect fewer continuation
   turns even before W2 (that is the W1 win) and lower `prompt→final` after.
2. a trivial single-file edit — expect fewer/zero auto-spawned children after 2.3.
3. a real build-with-failing-test — reinjection must be **unchanged** (guard).
Capture: `prompt→first-tool`, `prompt→final`, continuation count, child
count+duration. Adopt 2.1/2.2 only if the hard-task spot-check holds.

One change set on the *same* models, so latency wins are attributable.

- **2.1** `agent/settings.json` — `defaultThinkingLevel: "max" → "medium"`.
  Escape hatch: `/goal` and `--spec` request max explicitly.
- **2.2** `agent/settings.json` — `goal.maxTurns: 200 → 25`. Escape hatch: allow
  a per-invocation `/goal --max-turns N` override for exceptionally large runs.
- **2.3** `src/runtime/register-harness.ts:1640` + `:1656-1658` — rewrite the
  delegation directive to **inline-first**: do the work inline by default;
  delegate only when work is genuinely parallel, needs a specialist capability,
  or the user asked for `/waves`/deep review. Remove the "load the skill *and*
  delegate" coupling.
- **2.4** Confirm reporting/audit advisory (W1.3) is active on this path.
- **Verify:** re-run all three W0.2 baselines; expect lower `prompt→final` and
  `child count` on the trivial + audit prompts, unchanged reinjection on the red
  build. Spot-check one hard task at medium thinking for quality regression.
- **Risk:** medium thinking dulls hard-task quality; lower goal ceiling cuts a
  legitimate long run short. Both mitigated by the escape hatches (2.1/2.2) and
  the W0 before/after.
- **Rollback:** each of 2.1/2.2/2.3 reverts independently.

### W3 — Routing decision (RESOLVED: dead table deleted)

**Outcome (2026-07-22): deleted the stash; enable was not viable.**

Investigation settled this without a benchmark: the entire `savedAgentOverrides`
table (13 roles) pointed at `theclawbay/gpt-5.6-*` with `theclawbay-claude/*`
fallbacks, but **theclawbay is no longer an authenticated provider** —
`agent/auth.json` has only `google`, `zai`, `deepseek`, and `models-store.json`
lists the same three. The default was migrated off `theclawbay/gpt-5.5` to
`deepseek-v4-pro` at some earlier point, and the routing table was left dormant.

Enabling routing (`modelOverridesEnabled: true`) would have restored a table
pointing at a de-authed provider, breaking every subagent role. So "enable" was
impossible, and the coherent action was cleanup, not a strategy reversal — the
strategy this table encoded already died at the theclawbay→deepseek migration.

- **Done:** removed `savedAgentOverrides` from `agent/settings.json`; the block
  is now `{ disableBuiltins: true, modelOverridesEnabled: false }`. Every
  subagent role runs on the `deepseek-v4-pro` default. JSON validated.
- **Preserved:** the table survives in `agent/settings.json.bak-gpt-routing` and
  `agent/settings.json.bak-pre-w3-*` if tiering is ever rebuilt — but it should
  be rebuilt on an **authed** provider (deepseek/zai/google), not resurrected.
- **Note:** W2.3 inline-first already reduces subagent frequency, so per-role
  routing buys less than it once did. If tiering is wanted later (cheap model for
  explore/scout/evaluator, strong for oracle/plan/reviewer), that is a fresh,
  deliberate task on a live provider — not part of this plan.

### W4 — Contract expressiveness

**4.1 — DONE.** `evidenceRequired` is now conjunctive AND, plus an optional
`evidenceAnyOf: EvidenceRequirement[][]` — each inner group is a disjunction, the
groups are conjoined with each other and with `evidenceRequired`. The `fix`,
`secure`, and `refactor` criteria stopped pre-guessing `test` vs `command`; they
now carry `evidence: ["diff"]` + `evidenceAnyOf: [["test","command"]]`, so an
agent that verifies with *either* satisfies the criterion (previously "fix X"
demanded `command`, and an agent that ran the test suite hit a false negative and
the gate looped — the milder cousin of the W1 bug). Threaded through
`TaskCriterion`, `AcceptanceCriterion`, the contract binder, the verifier
(`acceptableKinds` + per-group satisfaction; unmet groups report as `test|command`),
and the schema validator (malformed groups rejected, not coerced). Audit path
untouched (still advisory). Tests: `tests/spec/evidence-anyof.test.ts` +
updated contract/engine assertions. Full suite target: green.

**4.2 — DEFERRED (deliberately).** Emitting evidence records for read/MCP/subagent
results has **no consumer** today (no criterion requires those kinds), so it would
produce dead data, and wiring read-evidence toward acceptance risks the
self-certification failure mode (Principle 3). Revisit only if a concrete
mutating criterion needs read/subagent corroboration.

### W5 — Cleanup (last; measurement-gated)

- **5.1** Child-runtime lazy loading — **only if** W0 metrics still show child
  cold-start (~10–23s) as a felt cost *after* W2 reduces child frequency. If
  inline-first drops child count enough, skip this.
- **5.2** Collapse duplicate interaction layers: one permission owner
  (governance vs external `permission-gate`), one clarification interface (`ask`
  vs `questionnaire`); make `slow-mode`/`context-mode` opt-in profiles.
- **5.3** Trim the always-visible skill surface (72 → ~15–25 auto-discoverable);
  rare capabilities behind explicit invocation.

## 5. Sequencing summary

```
W0 baseline ─▶ W1 (atomic contract+advisory) ─▶ W2 (speed bundle, no routing)
   ─▶ measure ─▶ W3 (routing alone) ─▶ W4 (anyOf) ─▶ W5 (cleanup)
```

**Hard constraints:** W1 lands atomically. W2 excludes routing. W3 is measured in
isolation. W5.1 is gated on W0 metrics.

## 6. Definition of done (per stage)

- W1: audit prompt = 1 turn / 0 continuations; red build still reinjects;
  `typecheck` + regression tests green.
- W2: measurable `prompt→final` drop on trivial + audit prompts; reinjection
  unchanged on mutating red build; one hard-task quality spot-check acceptable.
- W3: standalone routing benchmark recorded; no half-live override table.
- Keep intact throughout: secret-detection/immutable denies, `/goal`, `/waves`,
  jury/security review, subagents as a *selective* capability, formal `--spec`.
