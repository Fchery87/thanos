# ADR 0009 — `pi-subagents` is the sole delegation authority

**Status:** Accepted

## Context

Thanos currently has one live delegation engine and remnants of another:

- `pi-subagents` is installed and owns live specialist discovery, child launch,
  capability ceilings, budgets, async lifecycle, workflow graphs, acceptance
  evidence, worktree handoffs, and cleanup.
- The old Thanos `task` tool is no longer registered, but its subprocess
  launcher, result protocol, policy narrowing, transcript writer, worktree
  implementation, and tests remain.
- `/worktree gc` imports one function through the retired task module, keeping
  that implementation graph reachable.
- Thanos separately enumerates agent roles in a catalog, a model-routing
  selector, and governance overlays. These projections can drift from the live
  definitions resolved by `pi-subagents`.

Maintaining both execution models gives the same capability more than one owner.
It also makes a retired implementation look supported because it still compiles
and has tests.

## Decision

`pi-subagents` is Thanos's sole **Delegation Authority**.

Thanos owns operator-facing governance, specifications, goals, review policy,
and orchestration intent. It integrates those concerns with the public
contracts exposed by `pi-subagents`; it does not spawn a parallel child-agent
runtime or maintain an independent lifecycle protocol.

When a successor takes ownership of a capability, the completed change must
migrate its callers and state, replace or remove its commands, delete the old
runtime and tests, and remove obsolete configuration in the same implementation
slice. A temporary compatibility adapter is allowed only with an explicit
removal condition.

## Consequences

- Delete the retired TaskTool execution stack and tests after moving or removing
  the only live utility still imported through it.
- Remove `/worktree gc` unless it can operate on lifecycle state owned by
  `pi-subagents`; it must not preserve a second worktree format.
- Agent discovery, model selection, capability policy, and status displays must
  derive from the live delegation authority or from one explicit Thanos policy
  source. Static copies of the live roster are not authoritative.
- New orchestration behavior must compile to or constrain `pi-subagents`
  contracts. It must not introduce another subprocess, background-job,
  worktree, or result-delivery engine.
- This ADR supersedes the current implementation decisions in ADR 0001, ADR
  0004, and ADR 0005. Those ADRs remain historical records of the retired
  Thanos `task` engine.

## Alternatives considered

### Keep both engines

Rejected. Dual ownership creates drift, dead-code retention, and ambiguous
behavior without giving the operator a coherent fallback.

### Internalize delegation into Thanos

Rejected for the current system. It would require replacing and removing
`pi-subagents`, its configuration, patches, lifecycle artifacts, and workflow
integration. Thanos has no distinct execution requirement that justifies
owning that maintenance surface.
