# ADR 0006 — Completion verification gate

**Status:** Accepted

## Context

Thanos already generated a spec for non-instant prompts and collected evidence from assistant output and tool results. Before this decision, that verification was advisory: `agent_end` rendered a panel, but an agent could still stop after unmet criteria. That let weaker or tired models self-certify completion without producing the evidence the spec required.

The Fable-class harness roadmap calls for a stricter loop: criteria are defined before work, evidence is collected during work, and unfinished criteria are fed back as the next step. This matches the 2026 harness pattern described by LangChain's pre-completion checklist/Ralph loop, Anthropic's planner/generator/evaluator separation, and the broader agentic harness engineering practice of execution-grounded verification over self-report.

## Decision

Add a completion verification gate to the parent Thanos session:

1. At the end of each non-instant turn, verify the active spec's acceptance criteria against collected evidence.
2. If any criterion is still unmet, the session is a parent session, the retry budget remains, and the gate is enabled, send a follow-up user message containing a verification sentinel and the unmet criteria.
3. The follow-up is delivered through Pi's normal `followUp` mechanism, so the model receives the missing work as the next user turn instead of silently stopping.
4. Continuation turns carrying the sentinel do not regenerate the spec. The original goal, criteria, and evidence remain active across the retry loop.
5. The loop is bounded at three reinjections and can be disabled with `THANOS_VERIFY_GATE=off`.

The gate is intentionally evidence-based rather than claim-based. Criteria remain false until matching evidence exists, such as a diff, passing test command, command output, or explicit manual evidence.

## Consequences

- Ambient and explicit implementation tasks no longer end cleanly when required evidence is missing; they are re-prompted with the unmet criteria.
- The gate is parent-session only, preventing recursive verification loops inside subagents.
- The sentinel must remain stable because it is both the continuation marker and the guard that preserves the active spec.
- The retry budget prevents infinite loops. After three reinjections, the harness still reports the failed verification panel but stops reinjecting.
- `THANOS_VERIFY_GATE=off` exists as an operational escape hatch for debugging or emergency workflows, but the default posture is verification-on.
- The gate depends on criteria quality. The default-fail contract builder and fresh-context evaluator are therefore part of the same quality system, not optional polish.

## Amendment (2026-07-27) — only non-template criteria may drive continuation

The last consequence above turned out to be the whole story, and it was not
holding. The ledger recorded **739 gate failures containing three distinct
criteria strings**, all of them keyword templates from `buildTaskContract` —
"Requested code change is implemented in the relevant files" and two siblings.
Not one described a request anybody had made. Every forced continuation this
gate had ever driven, at roughly 48 a day, was spent chasing evidence for a
criterion nobody wrote.

The decision above is unchanged: unmet criteria still re-inject, still bounded at
three, still parent-only, still deferring to an active `/goal`. What changed is
which criteria count as unmet for that purpose.

`TaskCriterion.source` now reaches the gate (`AcceptanceCriterion.source` →
`VerificationResult.source`, mirroring how `verificationMode` arrives as
`advisory`), and `gatedFailures()` excludes `deterministic_fallback`. Template
criteria are still generated, still verified, and still reported in the turn
panel — they simply may no longer cost a model turn. An absent `source` stays
gated, so a future criterion source that forgets the field fails toward the gate
rather than away from it.

This makes the gate's usefulness depend entirely on semantic extraction
producing real criteria. At the time of writing it had produced **zero** in 48
attempts, for three independent reasons since repaired (the extractor prompt
instructed omission of fields the schema treated as mandatory; the target
whitelist rejected most of this repository; the prompt offered an explicit
bail-out). Whether the semantic path earns its per-turn model call was a live
question with a pinned threshold and a scheduled decision. **If that gate
decides against `src/spec/`, this ADR is superseded rather than amended again.**

## Amendment (2026-08-03) — the decision gate closed inconclusive, not superseded

The scheduled decision above ran. `src/spec/extractor-decision.ts` implements
it as a reproducible, pure function (`decideExtractorFate`) with the threshold
pinned in the amendment above plus one addition: a **minimum sample of 30
answer-qualified outcomes**, so a 4/7 or 1/1 run — both observed in the field
— cannot decide this. Read against the live ledger on 2026-08-02: **3**
`spec_extraction` rows total, all `timeout`, **0** qualifying. Below the
minimum, the verdict is `inconclusive`, not `keep` or `delete`.

This ADR is therefore **not superseded** — the prior amendment's condition
("if that gate decides against `src/spec/`") was never met, because the gate
did not decide either way. `src/spec/` and the completion verification gate
remain exactly as amended above. The open question is unresolved, not closed:
re-run `decideExtractorFate` against a fresh `readExtractionLedgerRows` window
once 30 qualifying outcomes exist, and amend this ADR again with whatever that
run decides. The full recorded observation (window, revision, counts,
rejection reasons) is filed under Phase 0 of
`docs/plans/2026-08-02-reasonix-informed-harness-architecture-plan.md` while
that plan is still live; once it completes and is deleted per the plan-document
lifecycle rule, this ADR — not that plan's git history — is the durable record.

## Amendment (2026-08-08) — observation-window semantics defined; timeout rate is a precondition

The decision procedure was formalized to prevent scope-bleed and unrepresentative verdicts:

1. **Per-Repository Scoping:** `ObservationWindow` is strictly per-repository (`window.repository`). Legacy rows lacking a `repository` field are rejected as `unscoped` rather than counted toward every repository's window simultaneously.
2. **Explicit Window Bounds:** A valid window requires an explicit `revision` (git commit SHA), `contractSchemaDigest` (schema identifier), and ISO time bounds (`start`/`end`) bracketing a single post-repair evaluation epoch. The repeatable runner `bun run extractor-decision` (`scripts/extractor-decision.mjs`) standardizes evaluation.

   **`revision` and `contractSchemaDigest` are declared labels, not verified facts.** No ledger row carries either field today, so `classifyRow`'s equality checks (`src/spec/extractor-decision.ts:180`) never fire against them and neither value constrains which rows are admitted. The runner's defaults — `git rev-parse HEAD` for `revision`, the literal string `contract-schema-v1` for the digest — record *when the report was produced*, not what the rows were produced under. Until the reporter emits both fields per row, a window's `revision` claim must be read as provenance for the report, and the ADR's intent (pinning prompt and engine logic under test) is not yet enforced by anything.

3. **Timeout Rate Precondition:** Across all eleven `.harness/evolution/events.jsonl` ledgers on the development machine, **150 of 185 logged extractions (81.1%) ended in `timeout`** under the default 10s budget (`DEFAULT_TIMEOUT_MS = 10_000`, `src/spec/extractor.ts:17`); the remainder are `accepted: 23`, `schema_rejected: 10`, `provider_error: 2`. (A single-repository run of the runner reports a similar rate off a much smaller slice — 24/29 — which is not the population figure and should not be quoted as one.) Because timeouts are operational outcomes excluded from the qualifying denominator (`QUALIFYING_OUTCOMES`), the accept rate is computed over the ~19% of calls that answered at all. A qualifying sample of 30 is only trustworthy once extractor timeouts are characterized and confirmed representative. No `keep` or `delete` verdict is recorded until these preconditions are met.

4. **The timeout rate cannot be attributed yet — `model` is unpopulated.** `ExtractionLedgerRow` declares an optional `model` field, but it is absent on **all 185 rows**. Nothing currently distinguishes "10s is too short for the configured extraction model" from "one particular model times out and the others do not," because the ledger does not record which model answered. **Populating `model` at emission is a prerequisite to investigating the timeout rate at all**, and is the next concrete step — ahead of any tuning of `spec.timeoutMs` and ahead of any accept-rate verdict. Note that a timeout is not a broken turn: it resolves `undefined` and the deterministic contract stands, so the cost is latency and an unused model call. Quantify that cost before treating the rate as urgent.
