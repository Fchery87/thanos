# ADR 0010 — Named workflows are enforced

**Status:** Accepted

## Context

Thanos exposes `/waves` and `Ctrl+Shift+R` as named orchestration and review
controls. Their current implementations only compose a follow-up prompt:

- `/waves` asks the parent model to discover, decompose, delegate, verify, and
  synthesize.
- `Ctrl+Shift+R` asks the parent model to run three critics, an oracle, and a
  final adjudication.

No runtime currently proves that the requested agents ran, their work was
independent, writer isolation held, required evidence arrived, or the final
verdict followed from the critic results.

The Delegation Authority already exposes versioned delegation requests,
workflow graphs, parallel and chained execution, capability ceilings,
structured outputs, acceptance gates, lifecycle updates, cancellation, and
worktree handoffs. Adding another executor would violate ADR 0009.

## Decision

A named operator-facing orchestration or review control is an **Enforced
Workflow**.

Thanos owns each workflow's policy and shape, and compiles it to public
`pi-subagents` delegation contracts. The runtime must record the graph, bind
results to nodes, enforce required gates, and produce a terminal outcome from
the collected evidence.

Ordinary conversational requests may remain prompt-directed. A command or
shortcut advertised as a particular workflow may not silently degrade to a
prompt convention.

When the enforced implementation replaces `/waves` or the review shortcut, the
prompt-only builder, registration path, and tests are deleted in the same
implementation slice.

## Consequences

- `/waves` uses a bounded graph with explicit dependencies, concurrency, node
  acceptance, and evidence. Its delegated nodes remain read-only until the
  public delegation contract can carry and verify the exact parent-approved
  Run Grant; a mutating plan fails before approval or child launch.
- The review workflow needs explicit critic nodes, an adversarial adjudication
  node, evidence-bound findings, and a deterministic terminal verdict surface.
- Workflow status and failure must come from runtime state rather than prose in
  a model response.
- The implementation must use the sole Delegation Authority established by ADR
  0009 and must not recreate child spawning, job tracking, worktree management,
  or result delivery in Thanos.
- Until replacement, the current controls must continue to describe themselves
  accurately as prompts.

## Alternatives considered

### Keep prompt conventions

Rejected for named workflows. They are lightweight but cannot support claims
about execution, independence, evidence, or completion.

### Keep prompts as a fallback beside enforced workflows

Rejected. Two implementations under the same workflow name would make behavior
dependent on an implicit fallback and preserve the dead path indefinitely.
