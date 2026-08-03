# Harness Evolution

Thanos treats agent failures as harness training data. A new rule, prompt, route,
or gate should not be added just because it sounds disciplined; it should answer
a concrete failure with a predicted improvement and a follow-up check.

## Event Ledger

High-signal events are recorded as JSONL at:

```text
.harness/evolution/events.jsonl
```

The ledger is for summaries and evidence references only. Do not log full
prompts, secrets, raw tool output, credentials, or large transcripts. Prefer
criteria names, artifact paths, command names, and short outcomes.

Every `HarnessEventType` (`src/observability/harness-ledger.ts`) is declared in
one TypeScript union, but a declared type is not evidence that anything writes
it. This table is the producer truth — checked against actual `appendHarnessEvent`
call sites, not against the type declaration:

| Event type | Status | Producer |
|---|---|---|
| `gate_failure` | **live** | `src/runtime/governance-hooks.ts` — completion verification gate reinjection (see ADR 0006) |
| `spec_extraction` | **live** | `src/spec/extraction-log.ts` — every semantic-extraction attempt (see the 2026-08-02 decision-gate closure amendment, ADR 0006) |
| `goal_set` | **live** | `src/runtime/register-harness.ts` — `/goal` lifecycle |
| `goal_achieved` | **live** | `src/runtime/register-harness.ts` — `/goal` lifecycle |
| `goal_paused` | **live** | `src/runtime/register-harness.ts` — `/goal` lifecycle |
| `waves_lifecycle` | **live** | `src/runtime/register-harness.ts` — Waves phase transitions |
| `gate_pass` | planned | declared, never produced |
| `review_disagreement` | planned | declared, never produced |
| `wave_handoff_rejected` | planned | declared, never produced |
| `delivery_gate_failed` | planned | declared, never produced |
| `manual_override` | planned | declared, never produced |
| `harness_change` | planned | declared, never produced |

"Planned" means exactly that and no more: the type is reserved so a future
producer doesn't collide with an existing name, but nothing in this repo emits
it today. Do not read a `HarnessEventType` member as proof an event is live —
run `grep -rn 'type: "eventName"' src/` (excluding the type declaration itself)
to check for an actual call site, or read `HARNESS_TOOL_NAMES`-style canonical
sources rather than trusting a type union to be current.

Every row may optionally carry `schemaVersion`, `repository`, and `timeoutMs`
(`HarnessEvent` in `src/observability/harness-ledger.ts`) — `repository` because
the ledger is per-repo (`<cwd>/.harness/evolution/events.jsonl`, one file per
project the harness has run in, not one shared ledger), `timeoutMs` where an
effective budget is relevant (e.g. the extractor), and `schemaVersion` so a
reader can reject a row shape it predates. `spec_extraction` rows populate all
three as of 2026-08-03; older event types remain optional-only, since nothing
currently makes a keep/delete decision from them.

## Change Manifest Rule

Every harness change should carry a manifest entry that answers:

1. What failure evidence motivated this?
2. What root cause do we believe explains it?
3. What exact harness component changed?
4. What outcome should improve?
5. What regression might this cause?
6. When will we check whether it helped?

Use `.harness/evolution/changes.example.jsonl` as the shape. A valid entry
requires failure evidence, root cause, targeted fix, predicted impact,
regression risk, and a follow-up check date or condition.

## Operating Loop

1. Observe a harness failure or recurring weakness.
2. Record or locate evidence in the event ledger, test output, review result, or
   artifact.
3. Write the manifest entry before or alongside the harness change.
4. Make the smallest targeted change.
5. Verify with focused tests and `bun run ci`.
6. Revisit the follow-up condition. Keep, revise, or remove the harness change
   based on observed outcomes.

This keeps the harness from becoming prompt folklore. Rules survive because they
help, not because they sounded plausible when written.
