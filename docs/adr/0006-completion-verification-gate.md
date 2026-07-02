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
