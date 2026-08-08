# ADR 0023 — Evidence-first workflow runtime stops at the Phase 1–4 seam

**Status:** Accepted
**Date:** 2026-08-05
**Decision owners:** Pi harness maintainers

## Context

The evidence-first workflow-runtime plan implemented four safe slices:

1. typed delegation failure normalization and artifact verification;
2. bounded snapshot outcomes and versioned execution/evidence observations;
3. the read-only `/run` projection;
4. the narrow `WorkflowModule` coordination seam with serialized dispatch and copied inspection.

The proposed follow-on work considered migrating every `/waves`, session, jury, goal, handoff, and `agent_end` lifecycle caller through that seam. Investigation showed that those callers cross independent authority owners:

- `SpecEngine` accepts operator work;
- `GoalController` owns ordinary goal continuation and completion claims;
- Pi owns session replacement and recovery;
- `DelegationRuntime`/`pi-subagents` owns child execution and recovery;
- existing workflow helpers own jury/evidence sequencing;
- `WorkflowRuntime` owns journaled workflow state.

Pi does not provide a stable `agent_end` delivery identity or a transaction spanning source handoff and replacement-session creation. Passing live Pi contexts through a broad facade would either make the facade a new authority container or preserve a misleading split authority graph.

## Decision

Stop the evidence-first workflow-runtime effort after Phases 1–4. Cancel the proposed lifecycle-caller migration and the remaining validation/baseline-red follow-on phases.

Keep `WorkflowModule` as a narrow coordination seam:

- `dispatch()` serializes runtime-owned lifecycle transitions and routes explicitly configured authority signals;
- `inspect()` returns copied observational workflow state and projection data;
- construction adapters remain fail-closed and do not expose authority objects through the public interface;
- Pi contexts, child handles, grants, acceptance decisions, and continuation state are never persisted by the module.

Do not migrate all existing lifecycle callers merely to satisfy a deletion goal. Existing authority owners and their tested orchestration remain authoritative.

## Consequences

### Positive

- Phases 1–4 remain small, testable, and authority-preserving.
- No second acceptance, delegation, continuation, or recovery system is introduced.
- Handoff remains honest about Pi's non-transactional session replacement boundary.
- Baseline-red replay and automatic validation do not gain an unauthorized execution path.

### Negative

- Some production lifecycle callers continue to use the established workflow authority directly.
- `WorkflowModule` does not provide a universal lifecycle boundary.
- A future full migration would require a new architecture decision, not a mechanical continuation of this plan.

## Revisit criteria

Reconsider only under a separately approved design that identifies:

1. the single authority responsible for each external effect and continuation;
2. a stable delivery identity and crash/replay policy for `agent_end`;
3. target binding for delayed signals;
4. handoff compensation semantics across Pi session replacement;
5. exactly one continuation owner for every Goal/Waves/Spec combination;
6. prepare, append, publish, and external-effect ordering with fail-closed recovery.

Until those criteria are met, no Phase 5–7 implementation should be started.
