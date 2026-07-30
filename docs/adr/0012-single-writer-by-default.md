# ADR 0012 — One writer per checkout by default

**Status:** Superseded by ADR 0020

## Context

The live Delegation Authority supports optional worktree isolation for parallel
groups. Its implementation:

- rejects worktree fan-out when the source repository is dirty;
- creates one Git worktree and branch per parallel task;
- captures each worktree as a patch artifact;
- records a parallel handoff;
- removes the worktrees and branches after capture.

Thanos does not currently force the worktree option. Its retired TaskTool
isolated writing roles automatically, so assumptions from that implementation
no longer describe the live path.

A disposable-repository verification against the installed `pi-subagents`
implementation confirmed:

- dirty source checkouts are rejected;
- parallel writers receive distinct worktrees;
- child edits do not mutate the parent checkout;
- disjoint patches can be reviewed and applied sequentially;
- worktrees and branches are cleaned after capture;
- conflicting task CWDs are detected;
- two patches that edit the same line do not compose automatically.

## Decision

Thanos uses one active writer per checkout by default.

Parallelism defaults to read-only exploration, research, and review. Multiple
writers require an explicit workflow decision, a clean repository, isolated
worktrees owned by `pi-subagents`, declared non-overlapping scopes, and
post-run verification that actual changed paths remain disjoint and in scope.

Parallel writers return patches and evidence. They never merge their own work.
One **Integration Owner**, normally the parent, reviews and applies accepted
patches sequentially.

If isolation, scope, cleanliness, patch capture, or cleanup cannot be
established, the workflow fails closed or falls back to one writer. It does not
run multiple writers in the shared checkout.

## Consequences

- Enforced workflows must distinguish read-only nodes from writing nodes before
  scheduling parallel work.
- Multi-writer fan-out sets the Delegation Authority's worktree option and
  records expected path ownership.
- The workflow rejects overlapping, out-of-scope, missing, or failed patch
  handoffs before integration.
- Integration is an explicit node with one owner and its own acceptance gates.
- Dirty repositories remain usable with a single writer; they are not eligible
  for parallel writer worktrees.
- No Thanos worktree manager or automatic merge engine is added.
- The legacy worktree implementation and `/worktree gc` remain deletion
  candidates under ADR 0009.

## Alternatives considered

### Multiple writers in one checkout

Rejected. Tool-level concurrency cannot protect repository state or prevent
overlapping edits.

### Automatically merge isolated writer branches

Rejected. Syntactic merge success does not establish semantic compatibility,
and conflicting patches require an accountable integration decision.

### Always use a worktree, including one-writer workflows

Rejected as a universal rule. The installed engine's worktree path requires a
clean repository, while ordinary interactive work often starts from deliberate
uncommitted changes.
