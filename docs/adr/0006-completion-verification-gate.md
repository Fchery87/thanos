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
bail-out). Whether the semantic path earns its per-turn model call is a live
question with a pinned threshold and a scheduled decision — see
`docs/plans/2026-07-27-harness-simplification-plan.md`, Phase 3. **If that gate
decides against `src/spec/`, this ADR is superseded rather than amended again.**
