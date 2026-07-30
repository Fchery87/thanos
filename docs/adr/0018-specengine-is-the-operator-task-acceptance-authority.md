# ADR 0018 — SpecEngine owns operator-task acceptance

**Status:** Accepted

Completion remains hierarchical: `pi-subagents` owns child-node acceptance, an
Enforced Workflow owns graph completion, and SpecEngine alone accepts the
operator's Work Contract. Goal Loop is only the Continuation Driver, and
`goal_complete` is only a Completion Claim. This supersedes ADR 0011's allowance
for either SpecEngine or Goal Loop to own operator-task completion.

Verification reproduced divergent verdicts from the current two systems:
Goal's evaluator accepted assistant text while SpecEngine rejected the same
work for missing diff and test evidence. It also showed that `goal_complete`
can mark a goal achieved before `agent_end` re-injects the unmet spec, and that
the first goal directive generates a replacement ambient spec because it is not
continuation-authorized.

The acceptance decision therefore occurs at `agent_end`, after the original
goal-derived Work Contract is settled and repository plus workflow evidence is
collected. Deterministic requirements must pass before a qualitative evaluator
may judge advisory criteria. Public Delegation Authority results must be mapped
into provenance-bound workflow evidence. The separate
`confirmGoalCompletion` decision path, last-turn-only evidence contract, and
duplicated completion tests are removed when this shared path replaces them;
lower-level evaluator transport and model-routing code may be reused.
