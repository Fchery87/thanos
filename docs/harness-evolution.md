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

Initial event types:

- `gate_failure`
- `gate_pass`
- `review_disagreement`
- `wave_handoff_rejected`
- `delivery_gate_failed`
- `manual_override`
- `harness_change`

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
