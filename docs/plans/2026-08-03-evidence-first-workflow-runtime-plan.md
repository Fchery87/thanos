# Architectural implementation plan: evidence-first workflow runtime

**Status:** complete — Phases 1–4 are implemented; Phase 5+ has not started <br>
**Date:** 2026-08-03 <br>
**Predecessor:** `docs/research/2026-08-03-pi-thanos-vs-fusion-harness-sssf.md`

## Goal

Give Thanos one truthful execution/evidence plane without creating a second authority system.

The implementation will:

1. repair the known workflow correctness gaps first;
2. define versioned local `RunFact` and `EvidenceReceipt` contracts;
3. build a pure operator projection from facts emitted by existing authorities;
4. place the existing parent-owned Waves runtime behind one small, deep `WorkflowModule` interface;
5. execute deterministic validation only by observing commands that already crossed the existing governed Pi tool path in this architectural slice;
6. defer automatic baseline-red replay until a separately approved execution-authority design proves an inseparable authorize-and-launch seam;
7. preserve SpecEngine acceptance, Goal continuation, Pi recovery, `pi-subagents` delegation, and single-writer integration.

This plan deliberately does **not** introduce a general workflow DSL, repository-loaded executable plugins, SQLite, a visualizer, a second journal, parallel writers, or persistent child mutation authority.

---

## 1. Decision

### 1.1 Selected design

Use a **projection-first deep facade**:

```ts
export interface WorkflowModule {
  dispatch(command: WorkflowCommand, signal?: AbortSignal): Promise<WorkflowReceipt>;
  inspect(): WorkflowView | undefined;
}

export function createWorkflowModule(
  dependencies: WorkflowModuleDependencies,
): WorkflowModule;
```

The module has one mutating entry point and one read entry point.

- `dispatch` owns atomic workflow transitions and their required fact emission.
- `inspect` returns a projection and cannot grant authority or mutate workflow state.
- SpecEngine remains the only operator-task acceptance authority.
- DelegationRuntime remains the only child execution authority.
- GoalController remains the ordinary Goal continuation driver.
- Pi and `pi-subagents` remain the parent and child Recovery Authorities.

### 1.2 Why this design won

Four independent designs were compared:

1. **Minimal deep dispatcher** — high depth and locality, but unsafe if introduced before evidence and governed-command seams exist.
2. **Extensible phase engine** — powerful recipe/compiler/event model, but too much new authority and migration risk for a personal daily driver.
3. **Thin observational kernel** — low migration risk, but leaves direct workflow calls and duplicated orchestration seams permanently exposed.
4. **Projection-first alternative** — safest sequencing, but insufficient alone because existing Waves callers would remain coupled to state internals.

The selected hybrid combines 1 and 4:

- evidence contracts and projections land first;
- the facade initially delegates to current Waves code without behavior change;
- direct state-transition calls are removed only after parity;
- no generalized phase engine is built.

### 1.3 Superseded, merged, and deferred plans

This document becomes the active implementation plan for this architectural slice.

| Existing plan | Treatment |
|---|---|
| `2026-07-27-harness-simplification-plan.md` | Preserve its personal-daily-driver constraint. Interpret “no new subsystems” as “no peer authority/executor”; this plan adds one local evidence projection and deepens an already-shipped enforced workflow. Do not add recipes/UI/SQLite in this slice. |
| `2026-07-26-spec-verification-evidence-plane-plan.md` | Merge its evidence-ground-truth principles. Do not replace existing Spec evidence matching. |
| `2026-07-22-harness-speed-and-spec-gate-fix-plan.md` | Preserve inline-first, prompt-budget, and hard-gate escape-hatch decisions. |
| `2026-07-21-permission-modes-design.md` | Leave untouched and out of scope. |
| `2026-07-23-permission-surface-2axis-design.md` | Leave design-only and out of scope. No permission schema migration is bundled here. |

Completed predecessor plans must be removed from `docs/plans/` after any durable decisions are moved into ADRs, per `AGENTS.md`.

---

## 2. Architecture

### 2.1 Authority map

| Concern | Authority after this plan |
|---|---|
| Operator-task contract and acceptance | `SpecEngine` |
| Tool/process authorization | `GovernanceRuntime` through the Pi tool-call path |
| Ordinary autonomous continuation | `GoalController` / Goal Loop |
| Enforced workflow continuation | Parent-owned `WorkflowModule` over current Waves runtime |
| Child discovery, execution, cancellation, recovery | `pi-subagents` through `DelegationRuntime` |
| Repository revision truth | Git via `captureRepositoryRevisionIdentity` |
| Durable workflow progress | Pi session `Workflow Journal` |
| Parent retry/auth/compaction | Pi |
| Child retry/auth/compaction | `pi-subagents` |
| Operator status | Pure `RunProjection` derived from authoritative facts |

A `RunFact`, `EvidenceReceipt`, `WorkflowReceipt`, or `WorkflowView` never grants authority and never declares operator-task acceptance.

### 2.2 Deep module and seam placement

The module lives at `src/workflows/module.ts`.

Its external interface hides:

- transition ordering;
- journal-before-effect rules;
- per-node exception normalization;
- evidence/artifact verification;
- revision checks;
- jury orchestration;
- SpecEngine evidence settlement;
- fact emission;
- projection updates;
- lifecycle idempotency;
- pause/resume/cancel/handoff behavior.

Internal implementation may keep separate files and internal seams. Callers and tests use the public interface whenever they are testing workflow behavior.

The deletion test justifies the module: without it, ordering, evidence settlement, journal writes, lifecycle signals, and status derivation reappear across `register-harness.ts`, hooks, tools, commands, and session restoration.

### 2.3 Dependency categories and adapters

| Dependency | Category | Adapter strategy |
|---|---|---|
| State reducer and projection | In-process | Pure functions; no public adapter |
| Filesystem/artifact verification | Local-substitutable | Real temporary filesystem in tests |
| Git revision capture | Local-substitutable | Temporary Git repositories in tests |
| Pi session journal | Remote but owned runtime seam | `WorkflowJournalAdapter`; in-memory adapter in tests |
| DelegationRuntime | Remote but owned runtime seam | `DelegationAdapter`; fake adapter in tests |
| Governance tool execution | Remote but owned runtime seam | `GovernedValidationAdapter`; no direct subprocess fallback |
| SpecEngine | In-process authority | Narrow `SpecAcceptanceAdapter`; real SpecEngine in integration tests |
| Harness ledger/projection sink | Local-substitutable | File sink plus in-memory sink; projection remains non-authoritative |
| Clock/IDs | In-process | Inject deterministic test functions |

Do not expose these adapters through the public interface merely to ease unit tests. They are construction dependencies at the composition root.

---

## 3. Domain additions

Add these terms to `CONTEXT.md` when Phase 2 lands:

**Run Fact** <br>
A versioned, bounded, redacted record emitted after an authoritative runtime action or decision. It is input to an operator projection and carries no mutation, continuation, or completion authority.

**Evidence Receipt** <br>
A provenance-preserving claim that evidence was observed and verified for a specific Work Contract revision and Repository Revision Identity. Artifact receipts bind path, full digest, byte length, producer, and revision; they must be revalidated when consumed.

**Run Projection** <br>
A deterministic read model reduced from Run Facts and current authoritative snapshots. It may be deleted or rebuilt without changing authorization, continuation, workflow progress, or acceptance.

**Validation Intent** <br>
An exact, contract-bound request to execute a deterministic command through the governed tool path. It includes criterion, executable, argv, cwd, targets, timeout, contract revision, and baseline policy; it carries no authority by itself.

**Workflow Receipt** <br>
The terminal typed result of one workflow command or phase attempt. It normalizes success, failure, blocking, cancellation, and timeout, but does not imply operator-task acceptance.

---

## 4. Load-bearing invariants

1. **No second acceptance authority.** Only SpecEngine can accept the operator task.
2. **No second child executor.** All delegated work uses DelegationRuntime/`pi-subagents`.
3. **No second recovery loop.** Pi and `pi-subagents` retain recovery authority.
4. **One continuation driver.** Active enforced workflow supersedes Goal; Goal supersedes ordinary Spec continuation.
5. **Single writer.** Delegated workflow nodes remain read-only; the main-session Integration Owner owns target-checkout mutation.
6. **Governed validation.** No arbitrary validation command starts outside the existing governance authorization and audit path.
7. **Journal before effect.** A workflow attempt must have durable start identity before its effect begins. A journal failure blocks the effect.
8. **One terminal receipt per attempt.** Throws, rejected promises, aborts, malformed responses, cancellations, and timeouts normalize to typed outcomes.
9. **Revision binding.** Review, gates, artifacts, and acceptance bind to an exact repository revision and active Work Contract revision.
10. **Consumption-time artifact verification.** In Phase 1, current artifact claims are verified for path, containment, symlinks, existence, bytes, and full SHA-256 whenever consumed. Phase 2 adds producer, Work Contract revision, and Repository Revision Identity to new receipts; those stronger checks apply after that schema lands.
11. **No durable authority.** Run Grants, continuation authentication, credentials, and live child/process handles never enter facts or journals.
12. **Projection purity.** Deleting or corrupting projection data cannot affect decisions.
13. **Bounded private data.** No raw prompts, credentials, environment dumps, or unrestricted stdout/stderr enter durable facts.
14. **Unknown is not zero.** Missing cost, usage, context, or process facts render as `unknown`.
15. **Prompt budget.** Facts remain out of prompts by default; any prompt projection is criterion-specific and bounded.
16. **Restore fails closed.** Unsupported Workflow Journal versions, active effects without terminal receipts, missing authority, or stale repository identity restore paused. Unsupported Run Fact versions degrade the projection with a warning and never influence restore.

---

## 5. Public contracts

### 5.1 Run facts

Create `src/execution/facts.ts`:

```ts
export interface RunFactBase {
  version: 1;
  factId: string;
  runId: string;
  sequence: number;
  occurredAt: string;
  source:
    | "goal"
    | "workflow"
    | "delegation"
    | "governance"
    | "spec"
    | "recovery";
}

export type RunFact =
  | WorkflowTransitionFact
  | DelegationSettledFact
  | ValidationObservedFact
  | EvidenceVerifiedFact
  | EvidenceInvalidatedFact
  | RecoveryOutcomeFact
  | AcceptanceVerdictFact
  | UsageObservedFact;
```

Facts contain bounded metadata and references, not transcripts.

### 5.2 Evidence receipts

Create `src/execution/evidence-receipt.ts`:

```ts
export interface EvidenceReceiptV1 {
  version: 1;
  receiptId: string;
  runId: string;
  producer: EvidenceProducer;
  criterionId?: string;
  contractRevision: string;
  repositoryRevision: RepositoryRevisionIdentity;
  observedAt: string;
  evidence: CommandReceipt | TestReceipt | ArtifactReceipt | ReviewReceipt;
}
```

An `ArtifactReceipt` includes a repo-contained canonical path, SHA-256, byte length, producer phase/node, and verification result. A receipt is not permanently trusted merely because it was once valid.

### 5.3 Workflow module

Create `src/workflows/module.ts` after the fact/receipt contracts are stable:

```ts
export type WorkflowCommand =
  | { kind: "start"; request: StartWorkflowRequest }
  | { kind: "restore" }
  | { kind: "signal"; signal: WorkflowSignal };

export type WorkflowSignal =
  | ApprovalSignal
  | ParentTurnEndedSignal
  | YieldSignal
  | PauseSignal
  | ResumeSignal
  | CancelSignal
  | HandoffSignal
  | GoalCompletionClaimSignal;

export interface WorkflowModule {
  dispatch(
    command: WorkflowCommand,
    signal?: AbortSignal,
  ): Promise<WorkflowReceipt>;

  inspect(): WorkflowView | undefined;
}
```

There is no public `appendEvent`, `recordEvidence`, `setPhase`, `complete`, or direct state-mutator method.

### 5.4 Validation intent

Create `src/validation/types.ts`:

```ts
export interface ValidationIntent {
  version: 1;
  gateId: string;
  criterionId: string;
  contractRevision: string;
  executable: string;
  argv: string[];
  cwd: string;
  expectedTargets: string[];
  timeoutMs: number;
  baselinePolicy: "none" | "must_fail";
}
```

A `ValidationIntent` must be an immutable part of an explicitly approved Work Contract before it can be executed automatically.

---

## 6. Implementation phases

Each phase must merge independently. Do not begin a later phase while a prior phase has unresolved correctness or security findings.

### Phase 0 — Reconcile plans and record architecture

**Purpose:** prevent implementation from silently contradicting current decisions.

**Files**

- Add `docs/adr/0023-evidence-first-parent-owned-workflow-runtime.md`
- Modify `docs/architecture/prompt-system.md`
- Modify `CONTEXT.md` only after the new terms have implementation in Phase 2
- Delete completed predecessor plan files once durable decisions are transferred

**ADR decisions**

- facts/receipts are observations, not authority;
- observability is a projection, not a store of workflow truth;
- Waves deepens behind one module rather than being replaced by a general phase engine;
- deterministic commands traverse GovernanceRuntime;
- repository-supplied executable adapters are rejected;
- recovery remains logical pause/resume/retry/cancel/handoff under ADR 0022;
- ADR 0022 is amended only so the existing snapshot attempt reports its outcome; its rejection of rollback/recovery machinery remains binding;
- permission redesign is explicitly out of scope.

**Acceptance**

- Architecture review confirms no existing ADR is silently contradicted.
- `docs/plans/` contains only genuinely live plans with `**Status:**` lines.
- No source behavior changes.

---

### Phase 1 — Correctness prerequisites

#### 1A. Normalize delegation failures per node

**Files**

- Add `src/execution/failure.ts`
- Modify `src/workflows/runner.ts`
- Modify `src/delegation/runtime.ts` only if its event seam can reject without normalization
- Add `tests/execution/failure.test.ts`
- Modify `tests/workflows/runner.test.ts`
- Modify `tests/delegation/runtime.test.ts`

**Behavior**

- Replace escaping `Promise.all` rejection with per-node settlement.
- Preserve successful sibling results.
- Required downstream nodes do not run when a required predecessor fails.
- Distinguish `failed`, `cancelled`, and `timed_out`.
- Preserve human-readable reason fields for compatibility.

**Acceptance tests**

- One accepted sibling + one rejected promise + one typed failure returns all three outcomes and does not throw.
- Required-node failure yields `awaiting_evidence`/paused behavior, never completion.
- Optional-node rejection does not erase successful required evidence.
- Listener cleanup still occurs after timeout, abort, and rejection.

#### 1B. Revalidate artifacts at every consumption seam

**Files**

- Add `src/workflows/artifacts.ts`
- Modify `src/workflows/runtime.ts`
- Modify `src/workflows/state.ts`
- Modify `src/workflows/agent-end.ts`
- Modify `src/spec/engine.ts` only through an explicit verified-receipt input
- Add `tests/workflows/artifacts.test.ts`
- Modify `tests/workflows/runtime.test.ts`
- Modify `tests/workflows/state.test.ts`
- Modify `tests/workflows/agent-end.test.ts`
- Modify `tests/spec/workflow-evidence.test.ts`

**Behavior**

- Resolve only canonical repo-contained paths in v1.
- Reject traversal, symlink escape, missing files, oversized files, unreadable files, and hash mismatch.
- Revalidate before:
  - predecessor evidence enters a delegated prompt;
  - accepted investigation evidence enters the integration directive;
  - restored evidence is reused;
  - jury evidence enters SpecEngine;
  - final workflow acceptance.
- Phase 1 validates only facts represented by the existing `WorkflowEvidenceRef`: containment, existence, bytes, and full SHA-256. It does not invent a temporary revision-bound receipt.
- Parsing a journal does not mark artifacts verified.
- Old external or temporary artifact paths restore paused rather than being silently trusted.

**Acceptance tests**

- A valid unchanged artifact passes containment/existence/hash verification after restore.
- Mutated/missing artifact cannot inform a downstream node or satisfy SpecEngine.
- Path traversal and symlink escape fail closed.
- A receipt with no artifact claims can still use accepted inline evidence if bounded and identity-matched.

#### 1C. Make snapshot outcomes visible

**Files**

- Modify `src/security/snapshot.ts`
- Modify `src/runtime/governance-hooks.ts`
- Modify `src/observability/harness-ledger.ts`
- Modify `tests/security/snapshot.test.ts`
- Modify/add governance hook tests at the current live seam

**Behavior**

Return a typed result:

```ts
type SnapshotOutcome =
  | { state: "succeeded"; reference: string; limitations: string[] }
  | { state: "skipped"; reason: string; limitations: string[] }
  | { state: "failed"; reason: string; limitations: string[] };
```

The caller records and displays it. Critical work may continue under current ADR 0022 policy, but failure is no longer silent.

**Acceptance tests**

- Untracked-only state is reported as a limitation.
- Git failure is distinguishable from “nothing to snapshot.”
- The operator receives a warning before critical work continues without recovery evidence.

**Phase 1 verification**

```sh
bunx vitest run \
  tests/execution/failure.test.ts \
  tests/delegation/runtime.test.ts \
  tests/workflows/runner.test.ts \
  tests/workflows/artifacts.test.ts \
  tests/workflows/runtime.test.ts \
  tests/workflows/state.test.ts \
  tests/workflows/agent-end.test.ts \
  tests/spec/workflow-evidence.test.ts \
  tests/security/snapshot.test.ts
bun run typecheck
bun run lint
```

---

### Phase 2 — Versioned fact and receipt contracts

**Purpose:** create a truthful local protocol before building status views or changing orchestration.

**Files**

- Add `src/execution/types.ts`
- Add `src/execution/facts.ts`
- Add `src/execution/evidence-receipt.ts`
- Add `src/execution/redaction.ts` only if the existing observability redactor cannot be reused
- Add `tests/execution/facts.test.ts`
- Add `tests/execution/evidence-receipt.test.ts`
- Add producer-focused tests beside the affected governance, delegation, workflow, Goal, Spec, and recovery modules
- Modify `src/runtime/governance-hooks.ts`, `src/delegation/runtime.ts`, `src/workflows/state.ts`, the existing Goal lifecycle seam, `src/spec/engine.ts`, and the snapshot owner to emit facts after authoritative settlement
- Modify `package.json` so `test:unit` includes `tests/execution`
- Modify `CONTEXT.md`

**Implementation**

- Version every durable fact and receipt.
- Add correlation fields: run, sequence, attempt, workflow/node/delegation identity where applicable.
- Add bounded/redacted output tails plus full-output hashes and truncation flags for command evidence.
- Never store raw prompts, complete child result text, credentials, environment values, auth state, or Run Grants.
- Keep `DelegationEvidenceEnvelope` unchanged; adapt accepted V2 data into local facts/receipts.
- Wire every v1 producer listed below in this phase. A fact is appended only after its authoritative action or decision settles.
- Represent unavailable usage/cost as absent/unknown.

**Producer contract**

Every projected field must name one authoritative producer:

| Fact | Producer |
|---|---|
| Governance authorization/denial | GovernanceRuntime hook |
| Delegation settled | DelegationRuntime after V2 validation |
| Workflow transition | WorkflowRuntime/Journal transition |
| Goal transition | GoalController lifecycle |
| Evidence accepted/invalidated | SpecEngine/evidence verification seam |
| Acceptance verdict | SpecEngine |
| Recovery outcome | Snapshot/Recovery Authority adapter |
| Usage | Delegation evidence when supplied |

Fields with no producer do not appear in v1.

**Acceptance tests**

- Unknown Run Fact versions are ignored with an explicit projection-degraded warning; they never affect authoritative restoration or workflow decisions.
- Receipts reject invalid paths, digests, revision identity, oversized tails, and secret-bearing fixtures.
- No new required fields are added to `DelegationEvidenceEnvelope`.
- Serialization round-trips bounded metadata only.

**Verification**

```sh
bunx vitest run tests/execution tests/delegation/evidence.test.ts tests/observability/redaction.test.ts
bun run typecheck
bun run lint
```

---

### Phase 3 — Pure run projection and operator status

**Purpose:** expose current truth without changing it.

**Files**

- Add `src/execution/projection.ts`
- Add `src/execution/goal-projection.ts`
- Add `src/execution/workflow-projection.ts`
- Add `src/commands/run.ts`
- Modify `src/commands/slash.ts`
- Modify `src/runtime/register-harness.ts`
- Modify `src/runtime/session-start.ts`
- Extend `src/observability/harness-ledger.ts` only with bounded fact summaries or references
- Add `tests/execution/projection.test.ts`
- Add `tests/commands/run.test.ts`
- Modify `tests/waves/register.test.ts`
- Modify relevant session-start/observability tests

**Interface**

```ts
export function reduceRunFacts(facts: readonly RunFact[]): RunProjection;

export function buildCurrentRunProjection(input: {
  facts: readonly RunFact[];
  goal?: GoalSnapshot;
  workflow?: WorkflowSnapshot;
  spec?: SpecSnapshot;
}): RunProjection | undefined;
```

**Behavior**

- Add `/run` and `/run status`; both are read-only.
- Reuse the same projector for `/waves status` so status formats cannot drift.
- Show only observed facts:
  - run kind, identity, goal, state;
  - phases/nodes and attempts;
  - blocking reason;
  - current Work Contract revision;
  - repository revision availability;
  - missing/gated evidence;
  - verified/stale artifact counts;
  - integration/jury counters;
  - available delegation model/session/usage;
  - recovery health;
  - observability degradation.
- Render unavailable timing, process, cost, or usage as `unknown`.
- Do not add retry/resume/cancel/accept commands to `/run` in v1.

**Acceptance tests**

- Replaying the same ordered facts twice produces byte-equivalent projection output.
- Duplicate summary writes do not duplicate semantic state.
- Deleting/corrupting projections does not affect workflow restore, permission, continuation, or acceptance.
- `/run` causes no journal append, continuation, prompt, approval, or state mutation.
- `/run` and `/waves status` show identical Waves state/counters/reasons.
- Restored runs show only reconstructable facts.

**Verification**

```sh
bunx vitest run tests/execution/projection.test.ts tests/commands/run.test.ts tests/waves/register.test.ts tests/observability
bun run typecheck
bun run lint
bun run measure
```

**Budget gate**

Static and dynamic prompt overhead must remain within 5% of the recorded baseline unless separately approved. The status projector must not be injected into the always-loaded prompt.

---

### Phase 4 — Introduce the deep WorkflowModule facade without behavior change

**Purpose:** consolidate callers only after facts and evidence are trustworthy.

**Files**

- Add `src/workflows/module.ts`
- Extend `src/workflows/types.ts`
- Modify `src/workflows/state.ts` so a transition is prepared, journal append is attempted, and in-memory state/facts publish only after the strongest acknowledgement Pi provides
- Add `tests/workflows/module.test.ts`
- Modify `src/runtime/register-harness.ts`
- Initially delegate to existing:
  - `src/workflows/state.ts`
  - `src/workflows/runtime.ts`
  - `src/workflows/runner.ts`
  - `src/workflows/agent-end.ts`
  - `src/workflows/tool.ts`
  - `src/workflows/session-control.ts`

**Implementation**

- Construct one module in the composition root.
- Preserve the current journal schema and restore behavior initially.
- The compatibility facade must still enforce prepare → append → publish ordering. If `pi.appendEntry` cannot acknowledge durable persistence, document that exact limitation and test the strongest observable ordering; do not claim atomic durability.
- Dispatch existing signals through the facade:
  - start;
  - approval result;
  - parent turn end;
  - workflow yield;
  - pause/resume/cancel/handoff;
  - goal completion claim;
  - restore.
- Emit facts only after authoritative state/journal settlement.
- `inspect()` delegates to the Phase 3 projection.
- Keep compatibility wrappers until every production importer migrates.

**Invariants tested at the interface**

- At most one continuation is queued per parent turn.
- One yielded revision launches at most one jury attempt and one SpecEngine settlement.
- Duplicate lifecycle signals are idempotent.
- Restored active work is paused and requires authority reacquisition.
- Jury approval is evidence, not completion.
- Goal-attached completion still requires a separate valid completion claim.

**Acceptance tests**

- Representative start/restore/yield/pause/resume/cancel/handoff scenarios use only `WorkflowModule`.
- Public types provide no direct completion/evidence/state mutation method.
- Existing current-journal fixtures restore through the facade unchanged.
- No direct facade path grants a Run Grant or executes a child.

**Verification**

```sh
bunx vitest run \
  tests/workflows/module.test.ts \
  tests/workflows/state.test.ts \
  tests/workflows/runtime.test.ts \
  tests/workflows/agent-end.test.ts \
  tests/workflows/yield-tool.test.ts \
  tests/workflows/session-control.test.ts \
  tests/spec/workflow-evidence.test.ts
bun run typecheck
bun run lint
```

---

### Phase 5 — Migrate lifecycle callers and remove duplicate workflow seams

**Purpose:** earn the facade’s locality by deleting direct orchestration from callers.

**Files**

- Modify `src/runtime/governance-hooks.ts`
- Modify `src/runtime/session-start.ts`
- Modify `src/commands/slash.ts`
- Modify `src/runtime/shortcuts.ts`
- Modify `src/workflows/tool.ts`
- Modify `src/workflows/agent-end.ts`
- Modify `src/workflows/session-control.ts`
- Internalize direct transition methods in `src/workflows/state.ts`
- Add/update integration tests

**Migration order**

1. `/waves` start/status/control commands.
2. `workflow_yield`.
3. `agent_end` integration/jury/acceptance signals.
4. session restoration.
5. shortcuts and standalone jury entry.
6. Goal-attached signals.

After each caller migrates, delete its direct old path before moving to the next.

**Deletion gate**

Production imports outside `src/workflows/` must not call:

- direct WorkflowRuntime transition methods;
- `runJuryWorkflow`;
- workflow journal append helpers;
- `recordWorkflowEvidenceRefs` as part of workflow sequencing;
- direct workflow continuation scheduling.

SpecEngine may still own its evidence interface; callers reach it through the workflow’s internal acceptance adapter.

**Acceptance tests**

- One continuation owner under every Goal/Waves/ordinary-Spec combination.
- Duplicate `agent_end` and yield signals do not double-count budgets.
- Pause/resume preserves consumed budgets.
- Handoff preserves intent/evidence references but no Run Grant or live child identity.
- Terminal parent retry failure pauses rather than launching a competing recovery loop.

**Verification**

```sh
bunx vitest run tests/workflows tests/goal tests/spec/workflow-evidence.test.ts tests/runtime/register-harness.smoke.test.ts tests/scenarios/system.scenario.test.ts
bun run typecheck
bun run lint
```

---

### Phase 6 — Observed validation receipts

**Purpose:** create deterministic validation evidence from commands that already passed the live Pi governance path, without introducing a new process authority.

**Scope decision**

This phase is observation-only. `GovernanceRuntime` currently authorizes Pi-originated tool calls but does not execute processes, and Run Grants currently bind mutation contracts rather than exact executable intents. Therefore this plan does **not** implement automatic replay or a `GovernedValidationAdapter`.

Automatic replay remains deferred until a separate approved design can name and test one concrete mechanism in which authorization and launch are inseparable—either a Pi-supported programmatic tool dispatch that emits the normal lifecycle, or a GovernanceRuntime-owned execute operation. That future design must include `src/runtime/governance-runtime.ts`, `src/governance/run-grant.ts`, `src/runtime/work-contract-approval.ts`, and Work Contract revision coverage.

No production validation module may call arbitrary `child_process`, `Bun.spawn`, or shell execution directly.

**Files**

- Add `src/validation/types.ts`
- Add `src/validation/envelope.ts`
- Add `src/validation/observed-validation.ts`
- Modify `src/spec/engine.ts` to accept a validation envelope through existing evidence vocabulary
- Modify `src/runtime/governance-hooks.ts`
- Modify `src/runtime/register-harness.ts`
- Add `tests/validation/types.test.ts`
- Add `tests/validation/envelope.test.ts`
- Add `tests/validation/observed-validation.test.ts`
- Modify `tests/spec/evidence-seam.test.ts`
- Modify `package.json` so `test:unit` includes `tests/validation`

**Implementation**

- Convert actual governed test/build/lint/typecheck `tool_result` events into `ValidationEnvelope`.
- Preserve exact executable, argv, cwd, timeout when known, exit/signal, duration, bounded redacted tails, hashes, truncation, criterion, contract revision, and repository revision.
- Distinguish command launch failure from a test that ran and failed.
- Deduplicate legacy and envelope-derived evidence by tool-call/attempt identity.
- Treat an envelope from a prior Work Contract or Repository Revision Identity as history, not current acceptance evidence.
- Feed envelopes into existing SpecEngine evidence kinds; do not create a parallel matcher or an `accepted` envelope field.

**Acceptance tests**

- One actual governed command creates one effective evidence record.
- Failed test, successful test, shell/launch error, timeout, and unknown command remain distinguishable.
- Output is bounded, redacted, hashed, and contains no environment secret.
- A stale contract/repository envelope cannot satisfy current acceptance.
- No arbitrary validation subprocess or replay entry point exists in production.

**Verification**

```sh
bunx vitest run tests/validation tests/spec/evidence-seam.test.ts tests/spec/engine.test.ts tests/runtime/governance-gate.test.ts
bun run typecheck
bun run lint
```

---

### Phase 7 — Deferred execution-authority and baseline-red design gate

**Status:** explicitly deferred; this phase produces a decision record and executable red tests only, not automatic gate execution.

**Purpose:** preserve Fusion Harness’s baseline-red idea without weakening Thanos’s authority model.

Before implementation, a follow-up architecture decision must prove all of the following:

1. one operation owns both authorization and process launch;
2. exact executable, argv, cwd, targets, timeout, environment policy, gate version, and artifact digest are bound into the Work Contract revision and Run Grant;
3. successful baseline discrimination happens before the mutation Run Grant is issued;
4. protected gate paths/blob identities cannot be edited, written, renamed, deleted, or command-mutated under that grant;
5. policy, egress, permission, Lens, snapshot, audit, and immutable denies still run;
6. baseline success is invalid/informational and can never authorize acceptance;
7. gate repair requires a new Work Contract revision and approval.

**Required files in the future implementation**

- `src/runtime/governance-runtime.ts`
- `src/governance/run-grant.ts`
- `src/runtime/work-contract-approval.ts`
- `src/spec/types.ts`
- `src/spec/contract-schema.ts`
- `src/spec/work-contract.ts`
- `src/spec/engine.ts`
- a concrete governed execute adapter owned by the authority seam
- adversarial governance/security tests

**This plan’s deliverables**

- Add an ADR or design appendix selecting the execution mechanism, or record that Pi provides no adequate programmatic tool-dispatch seam and keep replay deferred.
- Add failing/`it.fails` contract tests that pin baseline-before-grant, protected-gate mutation denial, baseline-green invalidity, stale revision, and gate-repair reapproval.
- Do not add `src/validation/baseline.ts` until the authority design is approved.

**Verification**

```sh
bunx vitest run tests/spec/work-contract.test.ts tests/runtime/governance-work-contract.test.ts tests/runtime/work-contract-approval.test.ts tests/security
bun run typecheck
bun run lint
```

---

### Phase 8 — Final cleanup, rollout, and measurement

**Files**

- Update `docs/reference.md`
- Update `docs/governance.md`
- Update `docs/architecture/prompt-system.md`
- Amend ADR 0020 only if journal representation changes; do not change parent ownership
- Delete this plan when complete after durable decisions live in ADRs

**Cleanup**

- Remove compatibility wrappers with zero production callers.
- Keep legacy journal reading for at least one compatibility window.
- Do not add SQLite/UI/recipes unless Run Facts demonstrate a concrete operator need.
- Do not remove legacy evidence collection until seam tests prove equivalent effective SpecEngine evidence with no duplication.

**Full verification**

```sh
bun run typecheck
bun run lint
bun run test:unit
bun run test:integration
bun run test:security
bun run test:perf
bun run test
bun run ci
bun run measure
```

Also perform one live manual flow:

1. start standalone Waves;
2. approve;
3. pause;
4. restart Pi;
5. confirm restoration is paused and authority is absent;
6. resume with fresh approval;
7. integrate and yield;
8. mutate after yield and confirm review evidence becomes stale;
9. yield again;
10. complete jury and SpecEngine acceptance;
11. compare `/run` with `/waves status` throughout.

**Performance acceptance**

- Static and dynamic prompt overhead: no more than 5% above the Phase 0 recorded baseline without separate approval.
- No new always-loaded prompt material for the event schema or status UI.
- Every delegated predecessor/evidence projection has an enforced character ceiling and explicit truncation marker.
- Cold import and suite wall-clock are reported honestly; suite duration is descriptive unless a stable gate is established.

---

## 7. Error model

Every operation settles into a typed outcome.

| Error | Required behavior |
|---|---|
| `invalid_command` / `invalid_transition` | Block before side effects |
| `authority_denied` | Pause/block; never downgrade to prompt convention |
| `contract_revision_mismatch` | Invalidate Run Grant and require approval |
| `journal_failed` | Do not start effect |
| `delegation_failed` | Preserve sibling outcomes; apply existing workflow budget |
| `delegation_timed_out` | Distinct terminal attempt; defer child recovery to Delegation Authority |
| `delegation_cancelled` | Distinct terminal attempt; do not consume budget where current policy excludes aborts |
| `artifact_missing` | Mark evidence stale and block consumer |
| `artifact_hash_mismatch` | Mark evidence stale and block consumer |
| `artifact_outside_root` | Security failure; block consumer |
| `validation_failed` | Command ran; preserve exact bounded machine failure |
| `validation_execution_error` | Command did not validly run; never count as baseline red |
| `revision_stale` | Block jury/gate/acceptance and return to integration or pause |
| `acceptance_rejected` | Preserve SpecEngine reason; workflow remains non-complete |
| `projection_failed` | Show observability degraded; do not alter truth |
| `unsupported_version` | Restore paused; never resume mutation |
| `ambiguous_effect_after_restart` | Pause for operator reconciliation; never replay blindly |

Retry eligibility is explicit and total-budgeted. Pause, resume, restore, handoff, and contract revision never reset consumed budgets silently.

---

## 8. Security review checklist

Before Phases 6 or 7 merge, independent reviewers must trace:

1. user/contract input to validation intent;
2. intent to Work Contract revision digest;
3. approval to process-local Run Grant;
4. intent replay through GovernanceRuntime;
5. policy, egress, capability, target, risk, secret, and snapshot checks;
6. actual command result to validation envelope;
7. envelope to evidence receipt;
8. receipt to SpecEngine verification;
9. yielded repository revision to jury and acceptance;
10. artifact revalidation at every consumer.

Required adversarial tests:

- shell metacharacters and substitution attempts;
- cwd/path traversal and symlink escape;
- mismatched argv after approval;
- forged V2 identity/digest;
- forged projection completion;
- stale artifact after restore;
- stale revision between yield and review;
- mutating reviewer role;
- budget reset by handoff/restart;
- projection deletion/corruption;
- yolo/unattended attempt to cross explicit denial;
- secret-bearing output and environment fixtures.

Any authorization or acceptance bypass blocks rollout. Observability degradation may warn and continue only where it cannot change authority or evidence validity.

---

## 9. Rollback strategy

Each phase is additive or facade-based until final cleanup.

- **Phases 1–3:** remove producers/projector; existing workflow truth remains intact.
- **Phase 4:** switch composition-root callers back to compatibility wrappers.
- **Phase 5:** revert one caller migration at a time; do not revert unrelated completed migrations.
- **Phase 6:** disable exact replay and retain observation-only validation envelopes.
- **Phase 7:** disable baseline policy in contract schema; ordinary validation remains.
- **Journals:** never write a format that the previous release cannot at least recognize as unsupported and pause. Keep legacy snapshot readers through the compatibility window.

Rollback must never reinterpret newer projection data as authority.

---

## 10. Definition of done

This architectural slice is complete when:

- [ ] rejected/throwing/cancelled/timed-out delegated nodes always settle individually;
- [ ] accepted sibling outcomes survive another node’s rejection;
- [ ] every consumed artifact is containment-, hash-, producer-, contract-, and revision-checked;
- [ ] snapshot failure/limitations are operator-visible;
- [ ] `RunFactV1` and `EvidenceReceiptV1` are versioned, bounded, and redacted;
- [ ] the V2 delegation transport contract was not expanded for local telemetry;
- [ ] `/run` and `/waves status` use one pure projection;
- [ ] projection loss cannot affect authorization, continuation, or acceptance;
- [ ] production workflow callers use `WorkflowModule`, not direct transition helpers;
- [ ] SpecEngine is the sole operator-task acceptance authority;
- [ ] DelegationRuntime remains the sole child execution authority;
- [ ] Goal and Pi recovery semantics remain unchanged;
- [ ] no arbitrary validation subprocess bypasses GovernanceRuntime;
- [ ] automatic baseline-red execution remains deferred until the Phase 7 authority decision is approved; if later implemented, its contract-bound and baseline-green-fail-closed tests pass;
- [ ] single-writer integration and fresh independent review remain enforced;
- [ ] all focused, unit, integration, security, performance, full-suite, CI, and measurement commands have been run and recorded truthfully;
- [ ] prompt overhead remains inside the approved budget;
- [ ] completed plan documents have been deleted after ADR/doc transfer.

---

## 11. Explicit non-goals for this plan

- A general workflow recipe/compiler/statechart product
- Repository-supplied executable phase adapters
- SQLite or another workflow database
- A visual workflow editor or remote dashboard
- Process-control endpoints in the projection layer
- Parallel writers in one checkout
- Child mutation authority under Waves
- Persistent Run Grants or continuation tokens
- Role names as authority
- Automatic filesystem rollback
- Replacement of SpecEngine, GoalController, Pi recovery, or `pi-subagents`
- Permission-mode or containment-schema redesign
- Unbounded raw prompt/output telemetry

These may be reconsidered only from measured Run Facts after this architecture is in use.
