# ADR 0015 — One Work Contract owns mutation approval

**Status:** Accepted

The SpecEngine will be Thanos's sole task-level approval authority. Read-only
work needs no contract approval. Before an Enforced Workflow mutates state, the
operator approves one immutable Work Contract revision binding its workflow
plan, capabilities, canonical target roots, delivery and egress boundary,
acceptance criteria, and bounded dynamic-fanout templates. A changed node,
agent, template, source, bound, capability, root, or egress class creates a new
revision and requires approval again.

The current explicit-spec path was verified to issue two prompts for one write:
`Spec Approval Required`, followed by `Permission Required`. It restricts only
capability names; `targetFiles` is not enforced. Session permission rules cannot
replace the contract because high-risk writes still prompt, and syntactic glob
matching accepted a path through an in-root symlink whose canonical parent was
outside the root.

Governance will enforce the approved Work Contract directly rather than copy it
into a second permission store. Reversible structured writes may skip repeated
prompts only when their canonical path is contained by an approved root.
Immutable policy denials always win. Shell commands, critical or irreversible
operations, credential access, unknown tools, and external side effects retain
their operation-specific gates.

`pi-subagents` produces deterministic static graph snapshots and enforces
dynamic `maxItems`, but a pre-materialization dynamic snapshot omits the child
agent and task template. Thanos therefore binds the canonical workflow plan,
including the dynamic template and bound, while the Delegation Authority
continues to own child launch contracts and node acceptance.
