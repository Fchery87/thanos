# ADR 0022 — No recovery plan beyond the pre-critical snapshot

**Status:** Accepted

`src/security/snapshot.ts`'s `createSnapshot` attempts to record a recovery
point before every critical (mutating) tool call — `git stash create` +
`stash store`, never `stash push`, so the working tree is never touched even
on failure. It is an attempt, not a guarantee: it returns `false` (no
snapshot recorded) for a clean tree, for untracked-only changes (`stash
create` does not capture them), and for any underlying git failure, and its
one call site (`governance-hooks.ts`) discards that boolean. A 2026-08-02
architecture plan proposed evaluating whether this needed to grow into a full
rewind/recovery feature (retention policy, explicit user confirmation,
conflict behavior, tracked/staged/unstaged/untracked/symlink/binary
semantics) and scoped that evaluation, deliberately, ahead of any
implementation.

The evaluation found no evidence to weigh. Because success and failure are
never distinguishable outside the process, let alone logged, a search of this
harness's own real, live-used `.harness/evolution/events.jsonl` and
`.harness/audit.jsonl`, every ADR, and this project's session memory records
found zero recorded snapshot attempts and zero user-reported loss or
recovery-failure incidents.

Zero observed attempts is not weak evidence of a problem — it is the total
absence of the evidence a recovery feature would need to be justified by.
Building one anyway would be exactly the kind of machinery this harness
otherwise measures before adding (see the extractor keep/delete gate, ADR
0006's 2026-08-03 amendment, for the same discipline applied to a different
subsystem). The decision is therefore to build nothing: `src/security/snapshot.ts`
and its call site keep their exact current behavior indefinitely, not as a
placeholder pending more data collection, but as the considered outcome.

Revisit only on concrete field evidence: a real, reproducible report of lost
work the snapshot should have prevented, or repeated snapshot failures
observed in practice. Fabricated or extrapolated evidence does not count —
if visibility into snapshot attempts becomes worth having in order to collect
real evidence, that is a small, separately-scoped follow-up in its own right,
not a reason to build a recovery feature ahead of the evidence.
