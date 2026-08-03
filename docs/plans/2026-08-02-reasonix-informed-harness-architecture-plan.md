# Plan: Reasonix-informed harness architecture

**Status:** in progress — Phases 0–4 landed (Phase 0 closed `inconclusive`) · **Date:** 2026-08-02 · **Owner:** parent integration session

## Goal

Improve Thanos using the highest-value architectural lessons from the current
DeepSeek-Reasonix `main-v2` line without turning Thanos into a second agent
runtime. The result should make authority, capabilities, diagnostics, and
recovery easier to reason about while preserving the existing Pi-owned turn
loop, prompt-cache boundary, governance ordering, SpecEngine acceptance
authority, and parent-owned Waves workflow.

## Decision summary

Build only two new deep modules, both at existing seams:

1. **Context provenance at the prompt seam** — strengthen the existing context
   envelope/rendering path so model-visible memory, evidence, goal state, and
   runtime context carry explicit origin, scope, authority, freshness, and
   bounded-content metadata. These labels are descriptive only and can never
   grant runtime authority.
2. **Canonical tool/capability contract** — extract one read-only projection of
   the actual registered tool surface and governance metadata. Runtime
   authorization remains owned by `GovernanceRuntime`; `/doctor`, `/tools`,
   tests, and documentation consume projections of the same source.

Add a third module only conditionally:

3. **Mutation recovery/rewind** — do not build initially. The existing
   pre-critical snapshot seam stays in place. A recovery feature requires a
   measured user-loss/recovery failure and a separately approved preservation
   design.

The first blocking gate is the existing semantic-extraction decision in
`docs/plans/2026-07-27-harness-simplification-plan.md`. No new architecture
may make `src/spec/` a prerequisite before that decision is complete.

## Architectural invariants

These invariants are binding for every phase:

- Runtime code owns capability ceilings, policy, delivery restrictions,
  continuation authentication, Run Grants, workflow scheduling, and acceptance.
- Prompt content, memory, evidence, tool descriptions, provenance labels, and
  model output are never authorization inputs.
- SpecEngine remains the sole operator-task acceptance authority under ADR 0018.
  Goal Loop is a continuation driver; `goal_complete` is only a claim.
- Waves remains parent-owned and single-writer under ADR 0020. Delegated nodes
  remain structurally read-only and `pi-subagents` remains the delegation and
  recovery authority.
- Pi remains the owner of context compaction, retry, authentication refresh,
  and host turn lifecycle. Thanos does not add a competing context engine.
- Volatile per-turn context stays outside the cached static system prompt.
- Unknown tools remain conservative and fail closed; MCP trust/validation stays
  at the MCP seam and is not replaced by generated metadata.
- Tests that drive registration, ledger writes, governance, MCP, workflows, or
  git snapshots use a disposable scratch directory or injected sink. Tests
  never write the repository's `.harness/evolution/events.jsonl` or
  `.harness/audit.jsonl`.
- Every phase is independently verifiable and may be stopped without landing
  later phases.

## Existing constraints and dirty state

At planning time:

- branch: `fix/release-workflow-eval`
- latest commit: `56ce1e5 fix(ci): remove stale release evaluation step`
- pre-existing modification: `agent/models-store.json`
- pre-existing untracked directory: `.pi-subagents/`

Neither pre-existing path is part of this plan. Do not revert, stage, or fold
those changes into implementation commits.

---

## Phase 0 — close the semantic-extraction decision gate

**Purpose:** settle the already-approved keep/delete decision before adding
ambient harness behavior.

### Scope

Use the existing repaired extraction telemetry from:

- `src/spec/extraction-log.ts`
- `src/spec/extractor.ts`
- `src/spec/engine.ts`
- `src/observability/harness-ledger.ts`
- `docs/plans/2026-07-27-harness-simplification-plan.md`

### Decision rule

Pin the minimum qualifying denominator at **30 answer-qualified outcomes**.
This prevents a 4/7 or 1/1 sample from deciding whether an ambient model call
survives. The quality denominator includes only:

- `accepted`
- `unparseable`
- `schema_rejected`
- `empty_objective`

Operational/configuration outcomes remain separately reported and excluded:

- `disabled`
- `no_context`
- `no_model`
- `auth_failed`
- `timeout`
- `provider_error`
- `threw`
- `stale`

The decision is:

- **Keep** `src/spec/` only when the observation window has at least 30
  answer-qualified outcomes and accepted semantic contracts are at least 50%.
- **Delete** `src/spec/` and its ambient extractor call below that threshold,
  following the existing simplification plan and an ADR successor/update.
- **Inconclusive** below 30 qualifying outcomes. Collect more data; do not
  keep or delete based on an undersized sample.

The observation record must include repository/cwd, observation-window ID,
revision, effective model, effective timeout, contract/schema digest, outcome
counts, and gate-failure count. The ledger is telemetry only; it is never
acceptance evidence.

### Implementation tasks

1. Add a pure aggregation/decision seam, preferably in
   `src/spec/extractor-decision.ts`, or keep it in the existing extraction-log
   module if that is demonstrably deeper.
2. Make the reader stream bounded JSONL fixtures or files; do not traverse all
   of `$HOME` from a test.
3. Reject malformed, duplicate, stale-window, future-schema, and provenance-
   missing rows from the decision input.
4. Record the final decision and observation metadata in the plan/ADR layer.
5. If deleting SpecEngine, stop this plan and write the acceptance-authority
   successor before continuing. Do not move acceptance into the context or
   capability modules.

### Tests

Extend:

- `tests/spec/extraction-log.test.ts`
- `tests/spec/engine.test.ts`
- `tests/spec/extractor.test.ts`
- `tests/observability/harness-ledger.test.ts`
- `tests/index.test.ts`

Add only if the decision seam is introduced:

- `tests/spec/extractor-decision.test.ts`
- `tests/fixtures/observability/extractor-decision/qualified.jsonl`
- `tests/fixtures/observability/extractor-decision/operational.jsonl`

Cases must cover zero/inconclusive, 29/inconclusive, 30 exactly, exactly 50%,
below 50%, excluded operational outcomes, duplicate rows, malformed rows,
wrong repository/revision, wrong window, and missing provenance.

### Acceptance gate

- The denominator and minimum sample are executable, not shell folklore.
- Test-generated rows cannot affect the decision.
- The decision is reproducible from the recorded observation window.
- If kept, normal use reaches at most five `gate_failure` events per day and
  extractor timeout/provider rates remain separately visible.
- If deleted, no ambient extraction call or semantic-specific documentation or
  test remains, and ADR 0018 has an explicit successor/amendment.

### Recorded observation — 2026-08-02

Implemented `src/spec/extractor-decision.ts` (`decideExtractorFate`,
`readExtractionLedgerRows`) and ran it read-only against the live
`.harness/evolution/events.jsonl`, repository `/home/nochaserz/.pi`, revision
`56ce1e5c86ee5986f18ab3eb60067304ff7a84fc`, window `2026-07-01`–`2026-08-02`:

| Metric | Value |
|---|---|
| `spec_extraction` rows read | 3 |
| Qualifying outcomes (accepted/unparseable/schema_rejected/empty_objective) | 0 |
| `accepted` | 0 |
| `gate_failure` rows in window | 739 |
| Verdict | **inconclusive** (0 < 30 minimum) |

All 3 real `spec_extraction` rows are `timeout` — an operational outcome,
excluded from the denominator by design. `src/spec/` has never produced a
qualifying outcome in this repository's ledger, so the gate has no basis yet
to keep or delete it; per the decision rule this is `inconclusive`, not a
failing score. The 739 `gate_failure` count is far above the plan's 5/day
target for a 32-day window, but that number belongs to
`docs/plans/2026-07-27-harness-simplification-plan.md` Phase 0, not this
decision — it is reported here only because the seam's contract requires
carrying it alongside the verdict.

Every `spec_extraction` row currently omits `repository`/`revision`/
`schemaVersion` (the live producer in `src/spec/extraction-log.ts` does not
emit them). That is why nothing here was rejected as `scope_mismatch` or
`future_schema` — the seam treats a row's absent repository/revision as
belonging to whichever file it was read from, per `ObservationWindow`, not as
grounds for rejection. Row-level provenance for a genuinely cross-repository
read is Phase 4 (ledger truth) work, not required to close Phase 0.

**Decision:** keep `src/spec/` as-is (no deletion — the gate has not failed,
it is simply unresolved) and keep collecting. Re-run
`decideExtractorFate` against a fresh `readExtractionLedgerRows` window once
30 qualifying outcomes exist. No ADR 0018 successor is written, because
`inconclusive` is not `delete`.

---

## Phase 1 — establish one safe context-provenance seam

**Dependency:** Phase 0 decision is recorded. This phase does not require the
semantic extractor to survive, but it must not duplicate its acceptance role.

### Module and interface

Use the existing `src/context/envelope.ts` and `src/context/render.ts` seam;
do not create a general context engine.

Proposed interface:

```ts
interface ContextEnvelope {
  id: string;
  origin: "memory" | "goal" | "evidence" | "runtime" | "instruction";
  authority: "runtime" | "instruction" | "memory" | "evidence";
  scope: "user" | "project" | "session" | "turn";
  source: string;
  capturedAt?: string;
  staleAfter?: string;
  content: string;
  maxBytes: number;
}

function renderContextEnvelope(envelope: ContextEnvelope): string;
```

Use the repository's existing origin/authority vocabulary if present instead of
introducing aliases. `trusted` may remain as descriptive metadata only; avoid
an ambiguous boolean that callers could interpret as an authorization grant.

### Migration

Touch only the existing context/prompt seam:

- `src/context/envelope.ts`
- `src/context/render.ts`
- `src/context/broker.ts`
- `src/memory/types.ts`
- `src/memory/injector.ts`
- `src/goal/prompts.ts`
- `src/runtime/prompt-assembly.ts`
- `src/runtime/before-agent-start.ts`
- `src/spec/extractor-prompt.ts` only if the extractor remains and its
  evidence/input rendering needs the same quoted-data contract

Tasks:

1. Validate IDs, scope, source, byte limits, and content before rendering.
2. Make memory, evidence, child output, and goal/runtime state visibly quoted
   and non-authoritative.
3. Keep trusted static instructions as runtime-owned system-prompt material;
   do not wrap them as if they were equivalent to evidence.
4. Keep all volatile envelope content in the existing hidden
   `harness-context` dynamic message.
5. Make block ordering deterministic.
6. On malformed optional content, omit that block and emit a bounded,
   non-sensitive diagnostic. Never mutate permissions or acceptance state.
7. Ensure child sessions retain their intended Pi base prompt but do not inherit
   parent-only memory or authority.

### Required invariants

- Changing only memory, goal, evidence, provenance, or diagnostics leaves the
  static `systemPrompt` byte-identical.
- Envelope metadata cannot widen capability, target root, delivery mode, Run
  Grant, continuation ownership, or acceptance status.
- Hostile content containing fake headers, JSON delimiters, role labels, or
  instructions remains content inside the quoted block.
- Over-budget/control-invalid content is rejected before delivery.
- No new model, network, filesystem, or MCP call occurs during composition.

### Tests

Extend:

- `tests/context/envelope.test.ts`
- `tests/context/render.test.ts`
- `tests/runtime/before-agent-start-prompt.test.ts`
- `tests/index.test.ts`
- `tests/prompt-system/instruction-surface.test.ts`
- `tests/performance/prompt-budget.test.ts`

Add a fixture file only if inline cases become difficult to review:

- `tests/fixtures/prompts/provenance-cases.json`

Include one live `before_agent_start` replacement test in a scratch repo,
comparing two turns with different memory/goal content. Assert static prompt
identity, dynamic message shape, parent/subagent separation, and hostile-content
handling.

### Acceptance gate

- No authority field is consumed by `GovernanceRuntime` as a new authorization
  source.
- Static-prefix bytes do not increase by more than 5% without an explicit
  approved budget change.
- Ordinary turns gain no model call and no network call.
- Prompt tests pass without writing repository ledgers.

---

## Phase 2 — canonical built-in tool contract and drift protection

**Dependency:** Phase 0 is complete. Phase 1 should land first so both planes
use the same authority terminology, but this phase does not depend on memory
semantics.

### Module and interface

Create one read-only projection module, likely:

- `src/governance/tool-contract.ts`

It must project existing registration and governance metadata, not become a
second authorization engine.

```ts
interface ToolContractEntry {
  name: string;
  source: "builtin" | "harness" | "pi-subagents" | "mcp";
  active: boolean;
  capability: "read" | "edit" | "exec" | "interaction" | "task";
  risk: "low" | "medium" | "high" | "critical";
  recognized: boolean;
  readOnly?: boolean;
  description: string;
  schema?: unknown;
  documentation: "required" | "generated" | "not-applicable";
}

interface ToolContractSnapshot {
  revision: string;
  entries: readonly ToolContractEntry[];
  summary: {
    active: number;
    recognized: number;
    unknown: number;
    readOnly: number;
    mutating: number;
  };
}

function buildToolContractSnapshot(input: ExistingRuntimeSurface): ToolContractSnapshot;
```

The exact input type should be the smallest adapter over the current Pi
registry, governance classifier, permissions, policy, delivery state, and
subagent role surface. Do not expose internals that callers do not need.

### Extraction strategy

1. Characterize current mappings in `src/governance/tool-call.ts`,
   `src/permissions/risk.ts`, `src/runtime/tools.ts`, and
   `src/workflows/tool.ts`.
2. Move duplicated static mapping data behind the new projection while keeping
   compatibility exports where needed.
3. Keep `GovernanceRuntime` responsible for side effects: policy decisions,
   prompts, snapshots, audit, and operation construction.
4. Use the contract for read-only presentation and drift tests.
5. Keep target-specific policy, explicit spec scope, Run Grants, local-only
   egress, and containment in the existing runtime resolver.
6. Keep MCP trust/validation in `src/mcp/manager.ts` and related modules. A
   connected MCP tool is not automatically a recognized built-in.
7. Render generated documentation only for the stable harness-owned/static
   tool surface. Do not inject the full contract into every model prompt.

### Runtime ordering to preserve

The refactor must preserve, in order:

1. immutable delivery egress/push denies;
2. policy deny;
3. explicit spec capability scope;
4. permission-manager deny/ask/allow;
5. Work Contract and Run Grant containment;
6. unattended handling;
7. yolo prompt bypass without crossing immutable denies;
8. interactive confirmation;
9. audit and operation creation.

### Documentation and commands

Make `/tools`, `/doctor`, and the relevant generated/reference sections consume
the same projection. Update:

- `src/runtime/commands/doctor.ts`
- `src/commands/slash.ts`
- `docs/reference.md`
- `docs/governance.md`
- `docs/architecture/prompt-system.md`

Do not make docs an authority source. Do not manually maintain a second table.

### Tests

Extend:

- `tests/governance/tool-call.test.ts`
- `tests/permissions/risk.test.ts`
- `tests/runtime/register-harness.smoke.test.ts`
- `tests/agents/roster-contract.test.ts`
- `tests/agents/catalog.test.ts`
- `tests/prompt-system/instruction-surface.test.ts`
- `tests/commands/presenters.test.ts`

Add:

- `tests/governance/tool-contract.test.ts`

Cover:

- every registered harness tool;
- unique names and stable ordering;
- non-empty description/schema metadata;
- workflow tools such as `workflow_yield`;
- parent-only and child-only tools;
- unknown/MCP tools and conservative fallback;
- policy deny under yolo;
- local-only egress;
- unattended behavior;
- explicit spec scope;
- Run Grant containment;
- consistency among runtime classification, `/tools`, `/doctor`, and docs.

### Acceptance gate

- No registered harness tool falls through the unknown path accidentally.
- Unknown tools remain fail-closed.
- Runtime authorization and diagnostic projection agree for identical inputs.
- Static tool-contract generation adds no ordinary-turn model call or prompt
  payload.
- Cold-import median and prompt budgets do not regress by more than 5% without
  an approved exception.

---

## Phase 3 — structured read-only diagnostics via `/doctor`

**Dependency:** Phase 2 contract projection.

### Interface

Refactor the existing command rather than adding a diagnostics subsystem:

- `src/runtime/commands/doctor.ts`

Split it into:

```ts
function collectDoctorDiagnostics(deps: DoctorInputs): readonly Diagnostic[];
function renderDoctorDiagnostics(diagnostics, theme): string;
function registerDoctorCommand(pi, deps): void;
```

Use a structured domain result:

```ts
interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  subsystem: string;
  source?: string;
  message: string;
  remediation?: string;
}
```

### Checks

Retain current policy, MCP, delivery, and patch-drift checks. Add only cheap
read-only checks for:

- effective tool-contract summary;
- model/subagent routing;
- loaded skills/shadowing if the existing roster exposes this safely;
- active goal/workflow/spec state;
- prompt-layer source summary;
- extraction health/outcome summary;
- stale or malformed live-plan status.

Default `/doctor` must not:

- start MCP servers;
- probe the network;
- invoke a model;
- mutate configuration or state;
- append a telemetry row.

### Tests

Add:

- `tests/runtime/doctor.test.ts`

Extend:

- `tests/runtime/register-harness.smoke.test.ts`
- `tests/prompt-system/instruction-surface.test.ts`

Use injected policy, MCP, delivery, and patch-drift adapters. Test:

- policy success/error;
- no MCP, connected, disabled, trust-blocked, operationally failed, mixed;
- registered/unregistered delivery;
- patch intact/drift/error;
- tool-contract summaries;
- worst-severity monotonicity;
- stable check order;
- main versus subagent behavior;
- no mutation/network/server startup/ledger append.

### Acceptance gate

- Collector tests complete in under 25ms with in-memory dependencies.
- Default command completes locally in under 250ms excluding any explicitly
  requested live probe.
- Errors cannot be downgraded by healthy checks.
- Blocked MCP is distinct from failed MCP.
- Structured diagnostics are testable independently of terminal rendering.

---

## Phase 4 — ledger truth and documentation reconciliation

This phase may run alongside Phase 3 but must land before closing the plan.

### Ledger truth

Update:

- `src/observability/harness-ledger.ts`
- `src/spec/extraction-log.ts`
- `docs/harness-evolution.md`
- `tests/observability/harness-ledger.test.ts`

Create a live producer/schema/documentation matrix. Either wire a documented
event or mark it planned/retired. Do not claim that declaration-only event
variants are live.

Every decision-relevant row should have bounded metadata sufficient to identify:

- event ID/schema version;
- repository/cwd or stable project ID;
- session/run ID;
- repository revision where relevant;
- observation-window ID where relevant;
- model/effective timeout where relevant;
- bounded summary/evidence references.

Never persist prompts, raw tool output, credentials, tokens, or secrets.

### Documentation truth

Reconcile:

- `docs/architecture/prompt-system.md`
- `docs/evaluations/prompt-system.md`
- `docs/governance.md`
- `docs/reference.md`
- relevant ADRs, especially `0018`, `0020`, and the Phase 3 outcome ADR
- live plan status lines under `docs/plans/`

The evaluation document must not promise the removed `bun run eval:prompts`
command. The prompt architecture document must not list runtime-owned
orchestration as an unimplemented phase. Completed plans must be deleted from
`docs/plans/` according to `AGENTS.md`; durable decisions belong in ADRs.

### Tests

Extend:

- `tests/observability/harness-ledger.test.ts`
- `tests/spec/extraction-log.test.ts`
- `tests/index.test.ts`
- `tests/prompt-system/instruction-surface.test.ts`

Add only if a public inventory/reader is introduced:

- `tests/observability/evolution-truth.test.ts`

Use hostile seeded strings to prove prompts/secrets never serialize. Drive live
producers with injected scratch cwd/sinks.

### Recorded outcome — 2026-08-03

Producer audit found only 6 of 12 declared `HarnessEventType` values ever
produced (`gate_failure`, `spec_extraction`, `goal_set`, `goal_achieved`,
`goal_paused`, `waves_lifecycle`); the other 6 were declaration-only. Recorded
an honest live/planned matrix in `docs/harness-evolution.md` rather than
wiring speculative producers for events nothing needs yet. `HarnessEvent`
gained optional `schemaVersion`/`repository`/`timeoutMs`; `spec_extraction`'s
live producer now populates all three. Added a closing amendment to ADR 0006
recording the Phase 0 decision-gate's `inconclusive` outcome (not superseded —
the "decides against `src/spec/`" condition was never met). Deleted
`docs/evaluations/prompt-system.md` (described the fully-removed fabricated
`eval-prompts.mjs` system) and removed `docs/architecture/prompt-system.md`'s
stale "Remaining Phase Map" (listed already-true runtime-ownership as future
work, and a rejected fabricated-eval direction as pending).

**Follow-up, not done here:** `docs/plans/2026-07-27-harness-simplification-plan.md`
is now fully resolved (every phase landed or closed) and per `AGENTS.md`
should be deleted with any durable decisions moved to ADRs. Left it live
rather than unilaterally authoring several ADRs mid-flight while implementing
a different plan — the MCP-wiring and unreachable-code-deletion decisions in
particular deserve their own considered pass.

`tests/index.test.ts` needed no change — nothing there references ledger
event types or the deleted eval doc.

---

## Phase 5 — conditional recovery evaluation, not implementation

Keep the existing behavior in:

- `src/security/snapshot.ts`
- `src/runtime/governance-hooks.ts`
- `tests/security/snapshot.test.ts`

Measure for a bounded field window:

- critical operations requesting snapshots;
- snapshot success/failure;
- tracked versus untracked-only changes;
- actual user-reported loss or inability to recover;
- snapshot latency and stash behavior.

Only create a recovery plan if the evidence demonstrates a recurring concrete
problem. That plan must define tracked/staged/unstaged/untracked/symlink/binary
semantics, retention, explicit user confirmation, conflict behavior, dirty-tree
preservation, and platform behavior before code is written.

Never use destructive stash operations on the active working tree. If the
failure evidence does not justify a robust solution, explicitly kill this phase
and retain snapshot-only behavior.

---

## Verification and delivery gates

### Before each phase

```sh
git status --short
bun run typecheck
```

Record the baseline relevant to the phase. Preserve unrelated dirty files.

### Focused validation

```sh
bun run test:prompts
bun run test:integration
bun run test:security
bun run test:perf
```

Use the narrowest relevant test file first. Any test that drives registration,
MCP, governance, workflow journaling, or ledger writes must run in a scratch
repo.

### Final validation

```sh
bun run typecheck
bun run lint
bun run test
bun run measure

git status --short
```

`bun run measure` remains descriptive until a stable baseline and approved
threshold exist. Do not replace it with synthetic latency/cost evaluation.

### Measurement record

Capture before/after:

- cold-import median/min/max over five fresh processes;
- static prompt bytes/tokens;
- dynamic tail bytes/tokens;
- roster size;
- ordinary-turn model-call count;
- canonical contract build/preflight cost;
- `/doctor` collection cost;
- relevant ledger row counts and outcome distribution.

The primary performance gates are:

- no new ordinary-turn model/network call;
- static prompt identity when only volatile context changes;
- no more than 5% prompt/cold-import regression without an explicit approved
  benefit and exception.

### Repository-state safety

Before and after the full suite, hash and compare:

- `.harness/evolution/events.jsonl`
- `.harness/audit.jsonl`

Any test-created or test-modified row in the project checkout fails validation.
The existing user modification to `agent/models-store.json` and untracked
`.pi-subagents/` must remain untouched.

## Kill criteria

Stop and remove the proposed work if:

1. Prompt metadata, memory, child output, or generated contracts can widen
   authority.
2. A second context, compaction, retry, scheduler, delegation, or acceptance
   engine appears.
3. Waves delegated nodes can mutate or transfer integration ownership.
4. Ledger rows lacking provenance can determine acceptance or subsystem survival.
5. Volatile context enters the cached static prompt.
6. Ordinary turns gain an unbounded or additional model call.
7. `/doctor` performs default network, server startup, model, or mutation work.
8. Runtime and diagnostic tool classifications disagree.
9. Recovery cannot preserve pre-existing user work.
10. A proposed evaluation depends on fabricated latency, cost, or model success.
11. Semantic extraction remains below the fair-run threshold after Phase 0.

## Non-goals

- No general context engine, transcript archive, semantic search, or automatic
  memory capture.
- No second orchestrator, planner/executor runtime, child lifecycle manager,
  delegated mutation, or parallel shared-checkout writers.
- No replacement for SpecEngine, Goal Loop, Waves, Pi compaction, or
  pi-subagents.
- No capability authority derived from prompts, docs, role names, MCP metadata,
  provenance labels, or model output.
- No dashboard or desktop UI before the shared diagnostics model is useful.
- No automatic rewind without concrete field evidence and a separate safety
  design.
- No broad model-evaluation product or feature-parity chase.

## Expected outcome

After the applicable phases:

- the semantic-extraction subsystem has a reproducible, contamination-safe
  keep/delete decision;
- volatile model context is explicitly bounded and provenance-labeled without
  gaining authority or destabilizing the cached prefix;
- built-in tool registration, governance classification, `/tools`, `/doctor`,
  and documentation share one contract projection;
- `/doctor` provides structured, read-only, actionable health information;
- evolution-ledger documentation describes actual producers and preserves
  decision-relevant provenance;
- the existing safety and ownership architecture remains intact;
- no new ordinary-turn model call or competing runtime subsystem is introduced.
