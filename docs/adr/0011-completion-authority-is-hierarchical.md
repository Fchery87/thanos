# ADR 0011 — Completion authority is hierarchical

**Status:** Superseded by ADR 0018

## Context

Thanos and its Delegation Authority currently have disconnected evidence
planes:

- Thanos's SpecEngine records evidence from `bash`, `edit`, and `write` tool
  results plus repository diff snapshots.
- The SpecEngine defines a manual evidence record, but no live runtime path
  produces one.
- A live `subagent` result is not translated into SpecEngine evidence.
- `pi-subagents` already reports execution, acceptance, review, effects,
  structured output, artifacts, and lifecycle state for delegated nodes.

An enforced workflow therefore could execute successfully while the parent task
gate remains unable to bind its results to acceptance criteria. Treating a
child's success summary as parent completion would solve the plumbing problem
by discarding the evidence boundary.

## Decision

**Completion Authority** is hierarchical:

1. `pi-subagents` owns execution and acceptance of each delegated child node.
2. The Thanos enforced-workflow layer owns graph completion and validates that
   required nodes and gates reached acceptable terminal states.
3. The Thanos SpecEngine or Goal Loop owns completion of the operator's task.

Evidence crosses each boundary with provenance. Completion authority does not.
A child result cannot directly complete a workflow, and a workflow result
cannot directly complete the operator's task without satisfying the receiving
contract.

The integration must consume the Delegation Authority's public result fields;
it must not create a second child acceptance protocol.

## Consequences

- Introduce an explicit, provenance-preserving mapping from delegation results
  to workflow evidence and from workflow evidence to task criteria.
- Bind evidence to run and node identity and retain relevant execution,
  acceptance, review, effects, command, artifact, and repository-state facts.
- Remove or replace evidence kinds that have no live producer. Do not preserve
  an unreachable `manual` path merely because it exists in the type union.
- A failed, cancelled, timed-out, budget-exhausted, structurally invalid, or
  acceptance-failed required node prevents workflow success.
- A successful child self-report is an input to validation, never sufficient
  proof by itself.
- The existing rule that the Goal Loop is the sole continuation driver while a
  goal is active remains unchanged.

## Alternatives considered

### Let child success satisfy the parent task

Rejected. It collapses trust boundaries and turns self-attestation into task
completion.

### Have the SpecEngine independently re-run every child acceptance check

Rejected. It duplicates the Delegation Authority's acceptance runtime and gives
the same node two completion owners.
