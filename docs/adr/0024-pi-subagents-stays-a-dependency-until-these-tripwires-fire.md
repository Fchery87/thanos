# ADR 0024 — pi-subagents stays a dependency until these tripwires fire

**Status:** Accepted

Reviewing bastani-inc/atomic — a much larger fork of the same underlying
agent runtime — surfaced a real option this harness has not taken: vendor
`pi-subagents` outright, own its ~66k lines directly, and delete the patch
mechanism entirely. Atomic did exactly this with its own fork of the same
upstream project, and it bought them things this harness cannot currently
have — most visibly, deleting an entire watchdog subsystem that this
harness has instead had to work around one hunk at a time (see the timeout
misclassification patch this same effort added, `scripts/patches/pi-subagents-0.41.0-evidence.patch`).

**Decision: stay on the dependency.** Continue patching `pi-subagents` in
place via `scripts/patch-pi-subagents.mjs` rather than vendoring it.

## Reasoning

This harness is an ~18k-line configuration and governance layer.
`pi-subagents` is ~66k lines. Taking ownership of a runtime nearly four
times this harness's own size is not a decision to make by default or by
convenience — it needs its own discipline (upstream tracking, a port-matrix
per release, a defensible merge story) that this harness does not currently
carry. Atomic's `research/` directory, with dated per-version upstream
diffs and commit-path inventories, is what that discipline looks like in
practice; adopting it is a real, ongoing cost, not a one-time decision.

`scripts/patch-pi-subagents.mjs`'s own history is the evidence for staying
on the dependency for now, not against it:

- A discovery-scanning patch (skip `.agents/skills` directories during
  agent discovery) was retired cleanly in 0.30.0 when upstream absorbed the
  same fix natively — the patch script's own self-heal logic detected this
  and reported it for retirement rather than silently going stale.
- A 0.37.2 evidence-envelope patch could not be forward-ported to 0.41.0 at
  all — upstream had deleted the code it anchored to, and the patch had to
  be re-derived from scratch against the new shape.

Both outcomes are what a healthy patch-and-track relationship looks like:
absorbed fixes retire themselves, broken ones fail loudly and get
re-derived, and the total patch surface has trended down, not up. As of
this ADR the artifact covers three concerns — the evidence envelope
(spread across three files: `delegation.ts` types, `delegation-request.ts`
acceptance validation, `delegation-adapters.ts` projection), the fanout
guard, and the timeout-classification guard — across five patched files,
against a ceiling of four: one concern of headroom, not zero. (An earlier
version of this ADR said "one hunk remains, the timeout-classification
guard," undercounting the other two concerns that were already present
alongside it; see the 2026-08-07 recalibration note below.) Vendoring
converts every one of these into work this harness's own maintainers must
do directly, on every upstream release, indefinitely.

## Tripwires

Any one of these reopens this decision — not "reconsider," fire the
tripwire and start the vendoring work:

- [ ] A patch fails to forward-port to a new `pi-subagents` release **and**
      its behaviour verifier (see `scripts/patch-pi-subagents.mjs`'s
      `verifyFanoutGuard`/`verifyV2EvidenceEnvelope`/`verifyTimeoutClassification`
      pattern) reports `broken` rather than "candidate for retirement."
- [ ] The patch artifact exceeds **4** hunks. Enforced mechanically — see
      Task 4.2.
- [ ] Upstream declines, or leaves unmerged for two minor releases, the
      evidence-projection PR that ADR 0019 depends on.
- [ ] A defect is found that cannot be expressed as a patch hunk at all —
      the same shape as Atomic's watchdog removal, which needed deletion of
      a whole subsystem, not a targeted diff against it.

## Recalibration (2026-08-07)

`scripts/patch-pi-subagents.mjs`'s hunk-ceiling tripwire counted
`PATCH_MARKERS.length` — one entry per patched *file* — against the ceiling
of 4. That put the artifact at 5 (three files for the evidence envelope,
plus the fanout guard and timeout-classification files) and fired the
tripwire message on every single patch run, contradicting both this ADR's
own prose above and every claim made elsewhere that no tripwire had fired.

The counter was wrong, not the ceiling. `PATCH_MARKERS` now names, for
each entry, the concern it belongs to, and the ceiling check derives its
count from the number of *distinct* concerns
(`new Set(PATCH_MARKERS.map((m) => m[3])).size`) rather than the number of
array entries. Three points, verified, established this was a calibration
fix rather than goalpost-moving:

1. **The script already rejected a lower-level count for this exact
   reason.** Its own comment explains why raw `^@@ ` counting was
   discarded: it "counts every non-contiguous change region per file
   separately and does not track the ADR's actual intent." That argument
   applies one level up unchanged — file-level markers also fail to track
   intent when a single concern spans three files.
2. **This ADR's own prose already counted concerns, not files.** The
   original text above said "one hunk remains ... the timeout-classification
   guard" — wrong on the number (three concerns remained, across five
   files), but unambiguous about the *unit*: it was never counting patched
   files.
3. **The surface has shrunk, not grown.** Two patches have retired against
   upstream absorption (discovery scanning at 0.30.0, `tui/render.ts` at
   0.31.0). A tripwire meant to detect growth firing on a shrinking surface
   was measuring the wrong thing.

The ceiling itself did not move — it is still 4. Today's real count is 3
concerns (evidence-envelope, fanout-guard, timeout-classification) against
that ceiling of 4: one concern of headroom. `PATCH_MARKERS` is the source
of truth for both the marker list and its concern labels, so a future
change cannot quietly relabel two concerns as one to duck the ceiling
without that relabeling being visible in the same diff.

See `tests/scripts/patch-concerns.test.ts` for the coverage that pins the
ceiling at 4 and proves the tripwire still fires at 5 distinct concerns,
and `docs/plans/2026-08-07-update-safety-and-atomic-adoptions.md`
("Decision A") for the fuller reasoning this note summarizes.

## Cost if triggered

Vendoring means:

- Owning ~66k lines of TypeScript directly, at roughly 3.7x this harness's
  own current size.
- A `research/pi-subagents-port-matrix.md`, maintained per upstream
  release, in Atomic's `research/` style — dated diffs, commit-path
  inventories, a documented decision for every behavioral change absorbed
  or declined.
- Deleting `scripts/patch-pi-subagents.mjs` and its self-heal mechanism
  (`src/welcome/patch-drift.ts`) entirely — there is nothing left to patch
  against once the fork is this harness's own.

None of that is free, and none of it should be paid on spec. This ADR
exists so the decision to pay it is made once, deliberately, when a
tripwire actually fires — not re-litigated from scratch under the pressure
of the break that triggers it.
