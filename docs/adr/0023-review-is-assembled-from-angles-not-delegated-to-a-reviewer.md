# ADR 0023 — Review is assembled from angles, not delegated to a `reviewer`

**Status:** Accepted

The roster (`src/agents/catalog.ts`) carries a generic `reviewer` alongside
three angle-specific variants: `reviewer-correctness`, `reviewer-security`,
`reviewer-tests`. The three variants already prove the decomposition works
— `buildJuryPlan()` (`src/workflows/runtime.ts`) fans a diff out to all
three in parallel, each with a narrow, distinct mandate, then has `oracle`
adjudicate across their findings. `reviewer` is the one path left that
routes an entire review to a single agent with no forced angle, and it is
the inconsistency: every other reviewer name states what it looks for,
`reviewer` states only that it looks.

Reviewing bastani-inc/atomic (a larger fork of the same underlying agent
runtime) surfaced the same conclusion stated as a rule, not just a
convention: its subagent skill is explicit that *"there is no generic
`reviewer` agent — assemble the review from read-only specialists with
distinct angles."* Atomic's roster has no generic reviewer at all;
`codebase-analyzer`, `codebase-pattern-finder`, and `debugger` (in
inspect-only mode) stand in for what a single "reviewer" would otherwise be
asked to do all at once.

A single reviewer agent is structurally worse at review than several
angle-specific ones dispatched together, for the same reason a single
`bash` command with five unrelated flags is worse than five one-purpose
tools: nothing forces it to actually cover every angle, nothing makes an
omission visible, and a finding phrased in general terms ("looks fine")
gives no signal about which angle went unchecked. `reviewer-correctness`,
`reviewer-security`, and `reviewer-tests` each fail loudly and specifically
when they find nothing — a correctness reviewer reporting no bugs is a
narrow, checkable claim; a generic reviewer reporting no issues is not.

**Decision:** retire `reviewer`. Every review composes from angle-specific,
read-only specialists — the existing `reviewer-*` family, extended as new
angles are identified (see Task 3.3, adding `reviewer-patterns` and
`reviewer-decisions`) — never from a single generic reviewer role.

This forbids:
- Adding a new generic `reviewer`-shaped agent as a shortcut when a review
  need doesn't cleanly fit an existing angle. The correct move is naming
  the missing angle and adding a specialist for it, the same way Task 3.3
  does — not widening an existing specialist's mandate or reintroducing a
  catch-all.
- A workflow or chain that delegates "review this" to one child with no
  stated angle. If a review step doesn't decompose into named angles, the
  step is under-specified, not the roster.

This does not forbid a single specialist being asked a broad question
within its own angle (`reviewer-security` reviewing an entire diff for
security issues is exactly its job); the constraint is against a single
agent asked to cover *every* angle at once under no name at all.
