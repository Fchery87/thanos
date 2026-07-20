# Phenomenal Harness Implementation Plan

**Status:** Proposed  
**Created:** July 19, 2026  
**Source assessment:** `docs/system-audit-2026-07-19.md`  
**Goal:** Turn Thanos into a compact, deterministic, high-performance agent harness that produces exceptional output across model families by making governance, isolation, orchestration, evidence, and evaluation runtime-enforced rather than prompt-dependent.

## Executive Direction

The implementation should not add another orchestration layer. It should consolidate the existing layers into one authoritative execution lifecycle:

```text
request
  -> normalized operation
  -> policy and capability ceiling
  -> approval or denial
  -> isolated execution
  -> validated result
  -> privacy-safe evidence
  -> bounded continuation
```

Every local tool, MCP server, subagent, review critic, evaluator, interaction primitive, and continuation driver must enter through this lifecycle or through an explicitly narrower adapter.

The program follows four rules:

1. Close fail-open behavior before architectural decomposition.
2. Replace prompt protocols with runtime protocols only when the runtime can enforce the whole contract.
3. Build deep modules with small interfaces; do not split `src/index.ts` into shallow pass-through files.
4. Keep every phase independently releasable and reversible.

## Non-Goals

- Replacing Pi or forking its full runtime.
- Introducing recursive, unbounded multi-agent delegation.
- Expanding the specialist roster before role execution is reliable.
- Adding more memory, search, debugging, or runtime tools during this program.
- Rewriting every module at once.
- Enabling autonomous network or credential access by default.
- Optimizing model prompts before the execution and evidence paths are trustworthy.

## Canonical Terms

These terms are load-bearing in this plan:

- **Governed Operation:** The normalized request evaluated before any effect occurs. It generalizes the current governed tool call to include tool execution, MCP startup, delegation, interaction, and continuation.
- **Governance Runtime:** The deep module that evaluates a Governed Operation and owns policy, permission, approval, audit, and pre-execution controls.
- **Session Runtime:** The deep module that owns session-scoped state and lifecycle transitions.
- **Agent Run:** One bounded subagent execution with a stable ID, effective policy, isolated working location when required, process state, result contract, and artifacts.
- **Run Store:** The durable per-run state under `.harness/subagents/<run-id>/`.
- **Evidence Claim:** A criterion-specific assertion linked to validated evidence. Generic successful activity is not an Evidence Claim.
- **Continuation Arbiter:** The single module that decides whether spec verification, goal mode, retry behavior, or user intervention may continue the session.
- **Trust Principal:** A distinct identity whose authority is evaluated independently, such as the parent agent, a specialist role, an MCP server, or a project configuration source.

## Target Architecture

```text
src/index.ts                         thin Pi composition root

src/runtime/
  session-runtime.ts                session state and lifecycle
  governance-runtime.ts             complete before/after operation path
  continuation-arbiter.ts           one continuation decision per turn
  register-lifecycle.ts             Pi lifecycle adapter
  register-commands.ts              command adapter composition
  register-shortcuts.ts             shortcut adapter composition
  register-tools.ts                 tool adapter composition

src/governance/
  operation.ts                      Governed Operation model
  decision.ts                       deterministic decision model
  effective-policy.ts               base + delivery + role ceilings
  headless.ts                       authoritative headless behavior
  egress.ts                         network and data-destination policy

src/agents/
  catalog.ts                        one specialist source of truth
  run.ts                            foreground/background Agent Run lifecycle
  run-store.ts                      atomic per-run persistence
  process.ts                        timeout, cancellation, process-group cleanup
  result.ts                         strict result validation
  artifacts.ts                      run-owned artifact validation
  change-handoff.ts                 patch/commit handoff for writers
  orchestrator.ts                   bounded fan-out and result collection

src/spec/
  evidence.ts                       validated evidence records
  claims.ts                         criterion-to-evidence matching
  verification.ts                   default-fail verification

src/review/
  jury-runtime.ts                   enforced critic/oracle workflow
  synthesis.ts                      deterministic finding aggregation

src/waves/
  runtime.ts                        enforced bounded wave execution

src/mcp/
  trust.ts                          server identity and startup approval
  runtime.ts                        generation-aware lifecycle
  command-service.ts                one typed MCP action path

src/observability/
  audit-queue.ts                    session-scoped ordered audit writer
  redaction.ts                      safe telemetry and audit shaping
  telemetry.ts                      stable internal operation spans
```

### Deep Module Interfaces

The initial interfaces should stay deliberately small:

```ts
interface GovernanceRuntime {
  authorize(operation: GovernedOperation): Promise<GovernanceDecision>;
  record(result: GovernedOperationResult): Promise<void>;
}

interface SessionRuntime {
  start(context: SessionStartContext): Promise<void>;
  reconfigure(change: SessionConfigurationChange): Promise<void>;
  stop(): Promise<void>;
}

interface AgentOrchestrator {
  start(request: AgentRunRequest): Promise<AgentRunHandle>;
  cancel(runId: AgentRunId): Promise<AgentRunState>;
  read(runId: AgentRunId): Promise<AgentRunState>;
}

interface ContinuationArbiter {
  decide(input: TurnCompletion): Promise<ContinuationDecision>;
}
```

Do not expose internal policy overlays, subprocesses, worktrees, JSONL parsing, audit queues, or evaluator calls through these interfaces.

## Program Invariants

The following invariants are mandatory throughout implementation:

1. A failure to create writer isolation never falls back to the parent checkout.
2. A policy ceiling can only narrow authority, never widen it.
3. Delegation cannot increase filesystem, process, network, credential, or autonomy authority.
4. Project-controlled MCP configuration cannot execute before explicit trust evaluation.
5. Unvalidated child or MCP output is never treated as authoritative state.
6. Only one continuation decision may be emitted for a completed turn.
7. Assistant prose cannot certify completion.
8. Audit and telemetry records never contain raw secrets by default.
9. Local-only means no remote data egress, not merely no `git push`.
10. Every background process has a stable owner, lifecycle state, timeout, and cancellation path.
11. Every runtime claim has an executable test that fails when enforcement is removed.
12. Each phase preserves compatibility for shipped behavior unless the plan explicitly deprecates it.

## Delivery Strategy

Use eight phases. Each phase ends with a release gate. Do not begin a dependent phase until its gate passes.

```text
Phase 0 Baseline
  -> Phase 1 Fail-Closed Security
  -> Phase 2 Trustworthy Agent Runs
  -> Phase 3 Authoritative Evidence
  -> Phase 4 Deep Runtime Modules
  -> Phase 5 Enforced Orchestration
  -> Phase 6 MCP and Operational Hardening
  -> Phase 7 Strict Types, Performance, and Release Gates
```

Phases 2 and 3 may proceed in parallel after Phase 1 because they own disjoint code paths. Phase 4 depends on both so it can compose stable behavior instead of moving defects.

## Phase 0: Establish the Baseline

**Objective:** Make regressions and improvements measurable before changing runtime behavior.

### Task 0.1: Capture the current quality baseline

**Files:**

- Create: `scripts/benchmark-harness.mjs`
- Create: `tests/performance/baseline.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Implement:**

- Record total test duration and slowest test files.
- Measure extension registration time.
- Measure `before_agent_start` latency with 0, 100, 1,000, and 10,000 session records using fixtures.
- Measure low-risk and critical `tool_call` hook latency.
- Measure MCP initialization with 1, 4, and 20 fake servers.
- Measure audit write latency under 1, 10, and 50 concurrent events.
- Record `src/index.ts` line count and import count as architectural metrics.

**Acceptance criteria:**

- Benchmark output is machine-readable JSON.
- CI stores benchmark output as an artifact.
- Benchmarks do not access real networks or credentials.
- Baseline numbers are recorded before optimization.

### Task 0.2: Split CI by responsibility

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Implement jobs:**

- `static`: typecheck and lint.
- `unit`: pure domain tests.
- `integration`: Pi registration, lifecycle, hooks, MCP fake servers.
- `security`: bypass and redaction regressions.
- `installer-linux`: fixture-based installer tests.
- `installer-windows`: PowerShell fixture tests.
- `performance`: bounded benchmark with regression reporting.

Set explicit job timeouts. Keep tests deterministic and hermetic.

**Gate 0:**

- Existing tests pass, or every known failure is recorded with an owner before implementation begins.
- No CI job can run indefinitely.
- Baseline artifacts are available for comparison.

## Phase 1: Close Fail-Open Security Defects

**Objective:** Make current claims true before adding new architecture.

### Task 1.1: Make writer isolation fail closed

**Files:**

- Modify: `src/agents/task-tool.ts`
- Modify: `src/agents/worktree.ts`
- Modify: `tests/agents/task-tool.test.ts`
- Modify: `tests/agents/worktree.test.ts`

**Implement:**

- Remove the `catch` fallback to `process.cwd()` for writing agents.
- Return a structured `error` contract when isolation cannot be established.
- Include a safe failure reason and no parent path details beyond an approved relative identifier.
- Assert that child spawning never occurs after worktree failure.

**Tests:**

- Worktree creation throws.
- Writer process is not spawned.
- Parent checkout remains unchanged.
- Read-only roles continue without a worktree.

### Task 1.2: Disable incomplete legacy writer execution

**Files:**

- Modify: `src/index.ts`
- Modify: `src/agents/task-tool.ts`
- Modify: `tests/index.test.ts`

**Implement:**

- Remove or hard-disable `THANOS_LEGACY_TASK=1` until Phase 2 provides complete handoff semantics.
- Return a clear migration message if the environment flag is present.
- Keep parsing helpers only when used by the live subagent engine or tests.

**Removal test:** Deleting the legacy registration must not remove any currently supported live `subagent` behavior.

### Task 1.3: Fix sensitive Git reads

**Files:**

- Modify: `src/permissions/risk.ts`
- Create: `src/permissions/git-target.ts`
- Modify: `tests/permissions/risk.test.ts`

**Implement:**

- Parse Git revision/path forms such as `HEAD:.env`, `main:config/secret.json`, and `:<stage>:path` where supported.
- Apply sensitive-path matching to the extracted repository path.
- Fail critical when the parser cannot prove the target safe.

**Tests:**

- `git show HEAD:.env` is not low risk.
- `git show HEAD:src/index.ts` remains low risk.
- Quoted and option-prefixed forms are covered.
- Ambiguous revision syntax fails safe.

### Task 1.4: Add central redaction

**Files:**

- Create: `src/observability/redaction.ts`
- Modify: `src/audit/logger.ts`
- Modify: `src/audit/target.ts`
- Modify: `src/security/scanner.ts`
- Modify: `src/spec/evidence.ts`
- Create: `tests/observability/redaction.test.ts`
- Modify: `tests/security/scanner.test.ts`

**Implement:**

- Redact bearer tokens, authorization headers, secret assignments, common provider keys, signed URL query values, and credential-bearing URLs.
- Replace scanner previews with secret type and line number only.
- Limit persisted summaries and rationale fields.
- Redact before persistence, not only before display.
- Preserve command family and safe structural metadata.

**Acceptance criteria:** Test fixtures containing synthetic secrets leave no complete value or meaningful prefix in logs, errors, UI text, or evidence.

### Task 1.5: Define and enforce egress policy

**Files:**

- Create: `src/governance/egress.ts`
- Modify: `src/governance/delivery-overlay.ts`
- Modify: `src/governance/tool-call.ts`
- Modify: `src/hooks/before-tool.ts`
- Create: `tests/governance/egress.test.ts`
- Modify: `tests/hooks/autonomy.test.ts`

**Implement:**

- Add an operation attribute for destination class: local, repository remote, network, credentialed network, unknown.
- Treat `curl`, `wget`, `scp`, `rsync`, SSH transfers, package publication, and equivalent commands as egress.
- In local-only mode, deny all remote egress regardless of unattended autonomy.
- Treat unknown egress as denied in local-only mode.
- Keep read-only local commands unaffected.

### Task 1.6: Restrict yolo to personal attended sessions

**Files:**

- Modify: `src/permissions/manager.ts`
- Modify: `src/index.ts`
- Modify: `src/hooks/before-tool.ts`
- Modify: `tests/permissions/yolo-lock.test.ts`
- Modify: `tests/hooks/autonomy.test.ts`

**Implement:**

- Team, CI, child, headless, and unattended sessions cannot enable yolo.
- Enabling or disabling yolo emits a redacted audit event.
- Yolo does not bypass immutable organization or delivery denies.
- Rename internal semantics if necessary so yolo clearly bypasses session prompts, not authoritative policy.

### Task 1.7: Harden installer trust and reproducibility

**Files:**

- Modify: `scripts/install.sh`
- Modify: `scripts/install.ps1`
- Modify: `tests/scripts/install.test.ts`

**Implement:**

- Normalize and exactly validate canonical repository host, owner, and name.
- Fail if no release tag exists unless an explicit ref is supplied.
- Use frozen lockfile installation.
- Refuse dependency installation when the lockfile is missing or mismatched.
- Test malicious lookalike remotes.

### Task 1.8: Fix MCP OAuth callback security

**Files:**

- Modify: `src/mcp/oauth.ts`
- Modify: `tests/mcp/oauth.test.ts`

**Implement:**

- Compare callback state using exact equality before token exchange.
- Reject duplicate callbacks.
- Render callback errors as escaped text.
- Bind to loopback only and preserve the existing timeout.
- Close the callback server on every terminal outcome.

**Gate 1:**

- Every identified fail-open defect has a regression test.
- Writers never execute in the parent checkout after isolation failure.
- Local-only unattended sessions cannot perform tested network egress.
- Synthetic secrets do not appear in persisted audit or scanner output.
- Project startup still works with MCP disabled or absent.
- Full security and integration jobs pass.

## Phase 2: Build Trustworthy Agent Runs

**Objective:** Replace ad hoc subprocess execution with a durable, validated Agent Run lifecycle.

### Task 2.1: Create the canonical specialist catalog

**Files:**

- Create: `src/agents/catalog.ts`
- Modify: `src/agents/registry.ts`
- Modify: `src/agents/policy.ts`
- Modify: `src/governance/role-overlay.ts`
- Modify: `src/agents/model-routing.ts`
- Modify: `src/agents/context-mode.ts`
- Create: `tests/agents/catalog.test.ts`

**Model:**

```ts
interface SpecialistProfile {
  id: SpecialistId;
  writes: boolean;
  executes: boolean;
  contextModes: readonly ContextMode[];
  mayDelegate: readonly SpecialistId[];
  modelRoutable: boolean;
  requiredTools: readonly string[];
}
```

Derive all role lists and overlays from this catalog. Keep compatibility exports temporarily, then remove them after all callers migrate.

**Acceptance criteria:** Adding a specialist in one catalog entry updates schema, policy ceiling, worktree behavior, context validation, and model routing tests.

### Task 2.2: Strictly validate result contracts

**Files:**

- Modify: `src/agents/result.ts`
- Modify: `tests/agents/result.test.ts`

**Implement:**

- Validate status, summary length, findings, artifacts, escalations, and metadata.
- Unknown or malformed canonical JSON becomes an explicit error contract.
- Preserve plain prose compatibility only for known legacy read-only paths, with `metadata.legacy = true`.
- Bound result size before parsing.
- Reject nested metadata beyond configured depth and total bytes.

### Task 2.3: Introduce the Run Store

**Files:**

- Create: `src/agents/run-store.ts`
- Modify: `src/agents/transcripts.ts`
- Modify: `src/agents/artifacts.ts`
- Create: `tests/agents/run-store.test.ts`

**Layout:**

```text
.harness/subagents/<run-id>/state.json
.harness/subagents/<run-id>/result.json
.harness/subagents/<run-id>/artifacts/
.harness/subagents/<run-id>/changes.patch
```

**Implement:**

- Atomic temp-file plus rename publication.
- State transitions validated against a transition table.
- Per-run ownership for artifacts.
- Retention limits by age, count, and total bytes.
- Startup garbage collection bounded by time and file count.

### Task 2.4: Implement bounded process lifecycle

**Files:**

- Create: `src/agents/process.ts`
- Modify: `src/agents/execution.ts`
- Modify: `src/agents/task-tool.ts`
- Create: `tests/agents/process.test.ts`

**Implement:**

- Spawn a process group where the platform supports it.
- Propagate abort and timeout.
- Send graceful termination, wait at most two seconds, then force-kill.
- Await process completion before cleanup.
- Await worktree cleanup with a bounded deadline.
- Preserve stderr diagnostics in a bounded, redacted field.
- Distinguish `cancelled`, `timeout`, `process_error`, and `invalid_result`.

### Task 2.5: Implement writer change handoff

**Files:**

- Create: `src/agents/change-handoff.ts`
- Modify: `src/agents/task-tool.ts`
- Modify: `src/agents/result.ts`
- Create: `tests/agents/change-handoff.test.ts`

**Decision:** Use a patch artifact as the default handoff. A commit SHA may be included when the child creates a commit, but the parent must not require child commits.

**Implement:**

- Capture tracked and untracked changes before worktree removal.
- Write a run-owned patch artifact.
- Record changed paths and base commit.
- Reject paths outside the assigned write scope when a scope exists.
- Keep the worktree when patch extraction fails and mark the run for recovery.
- Never auto-merge into the parent checkout.

### Task 2.6: Implement foreground and background Agent Runs

**Files:**

- Create: `src/agents/run.ts`
- Modify: `src/agents/task-tool.ts`
- Create: `tests/agents/run.test.ts`

**Implement:**

- One lifecycle for foreground and background execution.
- Foreground waits for a terminal state and returns the validated contract.
- Background returns a stable handle after `running` state is durably published.
- Add read and cancel operations through an existing governed tool or command surface; do not add an ungoverned side channel.
- Record requested and effective context modes.

**Gate 2:**

- Every run has a stable ID and valid state transition history.
- Concurrent runs do not overwrite metadata.
- Cancellation terminates descendants in tests.
- Writer output survives as a patch artifact.
- Invalid child output cannot masquerade as success.
- Legacy task registration remains disabled until these guarantees are integrated with it.

## Phase 3: Make Evidence Authoritative

**Objective:** Ensure completion claims require criterion-specific, externally grounded evidence.

### Task 3.1: Remove automatic manual evidence

**Files:**

- Modify: `src/spec/engine.ts`
- Modify: `src/spec/evidence.ts`
- Modify: `tests/spec/engine.test.ts`
- Modify: `tests/spec/evidence.test.ts`

**Implement:**

- Assistant messages never create passing evidence.
- Generic non-empty tool output never creates passing manual evidence.
- Manual evidence requires an explicit structured record from a human or trusted evaluator path.

### Task 3.2: Introduce typed evidence payloads

**Files:**

- Modify: `src/spec/types.ts`
- Modify: `src/spec/contract.ts`
- Modify: `src/spec/evidence.ts`
- Create: `src/spec/claims.ts`
- Create: `tests/spec/claims.test.ts`

**Model:**

```ts
type EvidenceRecord =
  | { kind: "diff"; paths: string[]; base: string; patchHash: string }
  | { kind: "test"; runner: string; args: string[]; exitCode: number; suites?: number; failures?: number }
  | { kind: "command"; family: string; argv: string[]; exitCode: number }
  | { kind: "manual"; actor: "user" | "evaluator"; claim: string; scope?: string[] };
```

Criteria should optionally declare expected paths, command families, or named test gates.

### Task 3.3: Parse command evidence structurally

**Files:**

- Create: `src/spec/command-evidence.ts`
- Modify: `src/hooks/after-tool.ts`
- Create: `tests/spec/command-evidence.test.ts`

**Implement:**

- Do not classify tests by substring search.
- Recognize configured test commands and known runner executables.
- Preserve argv, exit code, and runner identity.
- Treat `printf test`, `git grep vitest`, and shell strings containing runner names as non-test evidence.

### Task 3.4: Validate diff evidence against repository state

**Files:**

- Create: `src/spec/diff-evidence.ts`
- Modify: `src/spec/evidence.ts`
- Create: `tests/spec/diff-evidence.test.ts`

**Implement:**

- Read actual changed paths from Git rather than trusting tool input.
- Compute a stable patch hash.
- Match criteria only when required paths intersect actual changes.
- Treat writes that produce no diff as no evidence.

### Task 3.5: Default-fail criterion matching

**Files:**

- Modify: `src/spec/verification.ts`
- Modify: `src/spec/evaluator.ts`
- Modify: `tests/spec/verification.test.ts`

**Implement:**

- Every criterion begins unmet.
- Every required evidence dimension must match.
- Unsupported evidence kinds fail closed.
- Evaluator prose may explain evidence but cannot replace it.
- Return exact missing evidence requirements for continuation.

### Task 3.6: Bound evaluator execution

**Files:**

- Modify: `src/goal/evaluator.ts`
- Modify: `src/spec/evaluator.ts`
- Create: `src/evaluation/runtime.ts`
- Create: `tests/evaluation/runtime.test.ts`

**Implement:**

- Evaluator-specific timeout and abort propagation.
- Maximum output size.
- Maximum two attempts with explicit fallback reason.
- Record model, provider, latency, token usage when available, and fallback use.
- Fail closed on unreadable evaluator output.

**Gate 3:**

- `printf test` cannot satisfy test evidence.
- An edit that produces no relevant diff cannot satisfy a diff criterion.
- Assistant claims cannot satisfy any criterion.
- Every passing criterion exposes the exact evidence records that proved it.
- Unmet criteria produce deterministic continuation input.

## Phase 4: Establish Deep Runtime Modules

**Objective:** Consolidate execution behavior after security, runs, and evidence have stable contracts.

### Task 4.1: Generalize Governed Tool Call to Governed Operation

**Files:**

- Create: `src/governance/operation.ts`
- Modify: `src/governance/tool-call.ts`
- Create: `tests/governance/operation.test.ts`

**Variants:**

```ts
type GovernedOperation =
  | { kind: "tool"; ... }
  | { kind: "mcp_start"; ... }
  | { kind: "delegate"; ... }
  | { kind: "interaction"; ... }
  | { kind: "continuation"; ... };
```

Each variant carries principal, capabilities, safe target, risk, destination, and source trust.

Keep `evaluateGovernedToolCall()` as a compatibility adapter until all tool hooks migrate.

### Task 4.2: Implement Governance Runtime

**Files:**

- Create: `src/runtime/governance-runtime.ts`
- Modify: `src/hooks/before-tool.ts`
- Modify: `src/hooks/after-tool.ts`
- Modify: `src/index.ts`
- Create: `tests/runtime/governance-runtime.test.ts`

**Governance Runtime owns:**

- Effective policy construction.
- Role and delivery ceilings.
- Headless resolution.
- Session permissions.
- Yolo restrictions.
- Egress decisions.
- Audit recording.
- Secret and read-before-edit controls.
- Snapshot decisions.
- Evidence collection after execution.

`src/index.ts` should call only `authorize()` before execution and `record()` after execution.

### Task 4.3: Implement authoritative headless decisions

**Files:**

- Create: `src/governance/headless.ts`
- Modify: `src/policy/schema.ts`
- Modify: `src/policy/presets.ts`
- Modify: `tests/policy/schema.test.ts`
- Create: `tests/governance/headless.test.ts`

**Implement:**

- Resolve headless behavior in one function.
- Team and CI presets reject unsafe allow defaults.
- Personal defaults require explicit policy and remain constrained by immutable denies.
- Remove dead or ignored configuration options.

### Task 4.4: Implement Session Runtime

**Files:**

- Create: `src/runtime/session-runtime.ts`
- Create: `tests/runtime/session-runtime.test.ts`
- Modify: `src/index.ts`

**State model:**

```text
created -> policy_ready -> services_starting -> ready
ready -> reconfiguring -> ready
ready -> stopping -> stopped
any nonterminal -> failed
```

Session Runtime owns policy state, delivery state, permissions, spec state, goal state, MCP readiness, memory store, audit queue, and shutdown ordering.

### Task 4.5: Implement Continuation Arbiter

**Files:**

- Create: `src/runtime/continuation-arbiter.ts`
- Modify: `src/spec/gate.ts`
- Modify: `src/goal/loop.ts`
- Modify: `src/index.ts`
- Create: `tests/runtime/continuation-arbiter.test.ts`

**Decision variants:**

```text
stop
continue_spec
continue_goal
await_user
retry_runtime
pause_budget
```

At most one non-stop decision may be emitted per completed turn. Abort always wins. Goal/spec priority becomes explicit and tested rather than distributed across event code.

### Task 4.6: Move adapters out of `src/index.ts`

**Files:**

- Create: `src/runtime/register-lifecycle.ts`
- Create: `src/runtime/register-commands.ts`
- Create: `src/runtime/register-shortcuts.ts`
- Create: `src/runtime/register-tools.ts`
- Create: `src/interaction/register-tools.ts`
- Modify: `src/index.ts`

Move only translation logic into registration modules. Product behavior stays in deep modules.

**Exit target:**

- `src/index.ts` under 250 lines.
- No direct filesystem, subprocess, policy evaluation, MCP auth, or evaluator logic in `src/index.ts`.
- Register function reads as assembly.

### Task 4.7: Split Lens Lite by responsibility

**Files:**

- Create: `src/security/edit-guard.ts`
- Create: `src/security/change-tracker.ts`
- Create: `src/diagnostics/runner.ts`
- Create: `src/diagnostics/project-discovery.ts`
- Create: `src/commands/lens.ts`
- Remove or reduce: `src/lens/lite.ts`

Keep a facade only if lifecycle callers gain leverage from one interface. Apply the deletion test before retaining it.

### Task 4.8: Centralize model routing

**Files:**

- Create: `src/models/model-ref.ts`
- Create: `src/models/catalog.ts`
- Create: `src/models/routing.ts`
- Modify: `src/agents/model-routing.ts`
- Modify: `src/goal/evaluator-model.ts`
- Modify: related tests

Share parsing, authentication filtering, fallback resolution, capability checks, and thinking-level normalization.

**Gate 4:**

- `src/index.ts` is under 250 lines.
- Governance behavior is tested through `GovernanceRuntime` rather than private hook internals.
- One Continuation Arbiter decides every turn outcome.
- Role and model routing have one source of truth each.
- Benchmarks show no material regression from indirection; target less than 5% hook-latency increase before optimization.

## Phase 5: Replace Prompt Protocols With Enforced Orchestration

**Objective:** Make Jury and WAVES runtime guarantees real without creating a general-purpose swarm framework.

### Task 5.1: Build the bounded Agent Orchestrator

**Files:**

- Create: `src/agents/orchestrator.ts`
- Create: `tests/agents/orchestrator.test.ts`

**Capabilities:**

- Start a bounded parallel batch.
- Enforce maximum width and depth.
- Validate specialist role and policy ceiling.
- Propagate cancellation and deadlines.
- Collect validated result contracts.
- Reject duplicate run IDs and overlapping writer scopes.
- Return structured batch state.

Do not support arbitrary recursion. Delegation edges come from the specialist catalog.

### Task 5.2: Implement Review Jury Runtime

**Files:**

- Create: `src/review/jury-runtime.ts`
- Create: `src/review/synthesis.ts`
- Modify: `src/review/jury.ts`
- Modify: `src/index.ts` or shortcut adapter
- Create: `tests/review/jury-runtime.test.ts`
- Create: `tests/review/synthesis.test.ts`

**Workflow:**

1. Capture the review target and immutable diff reference.
2. Dispatch correctness, security, and test critics in parallel.
3. Require valid structured results from each or mark them failed.
4. Dispatch oracle with critic findings and the same immutable target.
5. Deterministically deduplicate and rank findings.
6. Derive verdict from retained severity.
7. Return one result with provenance for every finding.

The main model may explain the verdict but cannot invent findings not backed by a critic or oracle result.

### Task 5.3: Aggregate report findings through result contracts

**Files:**

- Modify: `src/review/findings.ts`
- Modify: `src/agents/result.ts`
- Modify: `src/review/jury-runtime.ts`
- Modify: report-finding registration

Remove reliance on child-local state as the parent aggregation mechanism. Child state may support rendering during the run, but final findings must be in the validated contract.

### Task 5.4: Implement WAVES Runtime

**Files:**

- Create: `src/waves/runtime.ts`
- Modify: `src/waves/plan.ts`
- Modify: `src/waves/verify.ts`
- Modify: `src/waves/command.ts`
- Create: `tests/waves/runtime.test.ts`

**Workflow:**

1. Produce or accept a typed plan.
2. Validate width, depth, dependencies, and writer path ownership.
3. Dispatch ready slices in bounded parallel waves.
4. Validate each result and evidence.
5. Stop dependent work after a failed required handoff.
6. Require synthesis review for partial or conflicting results.
7. Emit one structured outcome.

### Task 5.5: Add lifetime autonomy budgets

**Files:**

- Modify: `src/goal/controller.ts`
- Modify: `src/goal/types.ts`
- Modify: `src/runtime/continuation-arbiter.ts`
- Modify: related tests

Track lifetime turns, evaluator calls, wall-clock time, token growth, and explicit budget extensions. Resume opens a new window but does not erase lifetime accounting.

### Task 5.6: Remove prompt-only enforcement claims

After Jury and WAVES runtimes ship:

- Reduce prompts to task-specific instructions, not enforcement descriptions.
- Delete obsolete prompt protocol branches.
- If any runtime feature is deferred, label its command as advisory instead of enforced.

**Gate 5:**

- Tests prove critic and oracle execution occurs.
- Tests prove WAVES width, depth, and path ownership are enforced outside the model.
- A child cannot delegate beyond catalog edges.
- Cancellation stops all active runs in a batch.
- Verdicts and synthesis outcomes retain source-run provenance.

## Phase 6: MCP and Operational Hardening

**Objective:** Treat MCP servers as independent trust principals with bounded lifecycle and validated data.

### Task 6.1: Govern MCP server startup

**Files:**

- Create: `src/mcp/trust.ts`
- Modify: `src/mcp/config.ts`
- Modify: `src/mcp/manager.ts`
- Modify: `src/runtime/governance-runtime.ts`
- Create: `tests/mcp/trust.test.ts`

**Implement:**

- Distinguish global trusted config from project-controlled config.
- Normalize server identity from type, command or origin, args, and package or binary identity.
- Require approval or policy allow before project server startup.
- Bind approval to exact normalized identity.
- Pass a minimal environment allowlist to stdio servers.
- Audit startup separately from tool execution.

### Task 6.2: Add generation-aware MCP lifecycle

**Files:**

- Create: `src/mcp/runtime.ts`
- Modify: `src/mcp/manager.ts`
- Modify: `src/mcp/lifecycle.ts`
- Modify: `tests/mcp/lifecycle.test.ts`

**Implement:**

- Clear stale state during reload.
- Track registration generations.
- Reject stale tool closures.
- Deregister tools when Pi supports it; otherwise use stable proxy registrations that route to the active generation.
- Test repeated reload with identical names.

### Task 6.3: Bound MCP resource use

**Files:**

- Modify: `src/mcp/client.ts`
- Modify: `src/mcp/manager.ts`
- Modify: related tests

**Implement:**

- Maximum frame and buffer size.
- Bounded startup concurrency, default four.
- Per-server connect, initialize, and list-tools deadlines.
- Maximum registered tools per server and session.
- Bounded tool-result size before model-context insertion.
- Protocol errors become visible status, not silent discard.

### Task 6.4: Validate MCP inputs and outputs

**Files:**

- Modify: `src/mcp/manager.ts`
- Modify: `src/mcp/client.ts`
- Create: `src/mcp/validation.ts`
- Create: `tests/mcp/validation.test.ts`

Validate input schemas before calls and declared output schemas after calls. Treat tool descriptions and annotations as untrusted metadata unless the server principal is trusted.

### Task 6.5: Single-flight OAuth refresh and update checks

**Files:**

- Modify: `src/mcp/manager.ts`
- Modify: `src/welcome/update-check.ts`
- Modify: related tests

Deduplicate concurrent token refreshes per server and concurrent update checks per process. Publish cache files atomically.

### Task 6.6: Add session-scoped audit queue

**Files:**

- Create: `src/observability/audit-queue.ts`
- Modify: `src/audit/logger.ts`
- Modify: `src/runtime/session-runtime.ts`
- Create: `tests/observability/audit-queue.test.ts`

**Implement:**

- One ordered writer per session.
- Bounded queue and explicit overflow behavior.
- Flush during shutdown with deadline.
- Define fail-closed behavior for mandatory audit presets and fail-safe notification for personal mode.
- Record queue delay and write duration without high-cardinality fields.

### Task 6.7: Add privacy-safe hierarchical telemetry

**Files:**

- Create: `src/observability/telemetry.ts`
- Create: `tests/observability/telemetry.test.ts`

Use stable internal event fields and translate to OpenTelemetry at an exporter seam. Do not bind core code directly to unstable GenAI convention packages.

Trace hierarchy:

```text
session operation
  -> workflow or agent run
    -> model turn
    -> governed operation
      -> tool, MCP, or delegation execution
```

Record latency, outcome, policy decision, model/provider, token usage, retry count, and correlation IDs. Do not record prompts, hidden reasoning, raw tool output, or credentials by default.

**Gate 6:**

- Project MCP servers cannot start without trust evaluation.
- Repeated reloads do not duplicate or stale-route tools.
- Oversized frames and results fail predictably.
- Concurrent token refresh produces one refresh request.
- Audit flushing is deterministic on shutdown.
- Telemetry contains no synthetic secret fixtures.

## Phase 7: Strict Types, Performance, and Release Gates

**Objective:** Make correctness and performance sustainable after structural work.

### Task 7.1: Enable strict TypeScript incrementally

**Files:**

- Create optional scoped configs: `tsconfig.strict-boundaries.json`
- Modify: `tsconfig.json`
- Modify boundary modules and tests

**Order:**

1. Agent result and run contracts.
2. MCP validation and clients.
3. Governance operations and decisions.
4. Policy loading and schema parsing.
5. Evidence and evaluation.
6. Runtime modules.
7. Remaining source and tests.

Remove casts only after runtime validation. Do not replace casts with lying type guards.

### Task 7.2: Optimize the measured critical paths

Use Phase 0 benchmarks to target actual regressions:

- Coalesce snapshots per turn and dirty-tree state.
- Bound or avoid complete session enumeration.
- Cache immutable roster and catalog data per session.
- Keep policy compilation and overlays stable until reconfiguration.
- Avoid reconstructing audit and hook objects per call.
- Limit injected memory, roster, evidence, and subagent summaries by token budget.

### Task 7.3: Add property and adversarial tests

**Targets:**

- Shell and Git risk classification.
- Policy first-match and session last-match semantics.
- Egress classification.
- Result-contract validation.
- Run-state transitions.
- Evidence matching.
- Path containment and writer-scope overlap.
- Redaction idempotence and no-secret output.

Include poisoned MCP output, malformed child output, approval fatigue sequences, memory injection attempts, and cross-agent privilege escalation.

### Task 7.4: Add end-to-end Pi integration

Create a hermetic test extension host that exercises:

- Registration.
- Session start and stop.
- Interactive and headless tool calls.
- Parent and child role narrowing.
- MCP startup approval.
- Agent Run lifecycle.
- Spec failure continuation.
- Goal and spec continuation arbitration.

### Task 7.5: Establish release SLOs

Initial targets, subject to Phase 0 baseline adjustment:

- Low-risk governance hook p95 overhead: below 10 ms excluding mandatory disk flush.
- High-risk decision path p95 excluding user wait: below 25 ms before snapshot work.
- Extension registration p95: below 250 ms without MCP connections.
- Startup with 1,000 session fixtures: below 500 ms before optional network checks.
- No unbounded queue, buffer, result, transcript, or artifact store.
- Full CI wall time: below 10 minutes with jobs parallelized.
- Flaky-test rate: below 0.5% over 100 runs.
- Security bypass suite: zero known failures.

### Task 7.6: Remove compatibility scaffolding

After two stable releases:

- Remove legacy result parsing where no supported path uses it.
- Remove duplicate role and routing exports.
- Remove the dormant legacy task flag or reintroduce it only as an adapter over Agent Orchestrator.
- Remove `LensLite` if its facade no longer adds depth.
- Remove deprecated evidence fields.
- Remove ignored headless options.

**Gate 7:**

- Main TypeScript configuration is strict or has a documented, shrinking exception list.
- All release SLOs are measured in CI.
- Full integration, security, installer, and performance jobs pass.
- No P0 or P1 finding from the source assessment remains open without explicit acceptance.

## Dependency Graph

```text
0.1 baseline -----------------------------> 7.2 performance
0.2 CI split ------------------------------> all phase gates

1.1 writer fail-closed -> 2.5 change handoff -> 2.6 Agent Runs
1.4 redaction ---------> 6.6 audit queue ----> 6.7 telemetry
1.5 egress ------------> 4.2 Governance Runtime
1.8 OAuth security ----> 6.1 MCP trust

2.1 catalog -----------> 5.1 Agent Orchestrator
2.2 result validation -> 2.6 Agent Runs -----> 5.1 Agent Orchestrator
2.3 Run Store ---------> 2.6 Agent Runs -----> 5.2 Jury / 5.4 WAVES
2.4 process lifecycle -> 2.6 Agent Runs

3.1-3.5 evidence ------> 4.5 Continuation Arbiter
3.6 evaluator runtime -> 5.2 Jury synthesis and goal completion

4.1 operation model --> 4.2 Governance Runtime -> 6.1 MCP trust
4.3 headless ---------> 4.2 Governance Runtime
4.4 Session Runtime --> 4.6 index decomposition
4.5 Arbiter ----------> 4.6 index decomposition

5.1 Orchestrator -----> 5.2 Jury and 5.4 WAVES
6.1 MCP trust --------> 6.2 MCP runtime
```

## Commit and Review Strategy

Each task should be one reviewable change when practical. Do not mix behavioral fixes with file movement.

Preferred sequence inside a task:

1. Add a failing regression or contract test.
2. Implement the smallest complete behavior.
3. Run focused tests.
4. Run the phase-level static and integration gates.
5. Record benchmark changes when the critical path changes.
6. Commit with one purpose.

High-risk tasks require an independent review before merging:

- Writer isolation and change handoff.
- Egress policy.
- OAuth and MCP trust.
- Governance Runtime cutover.
- Evidence matching.
- Agent Orchestrator.
- Jury and WAVES runtime enforcement.
- Audit redaction and telemetry.

## Migration and Compatibility

### Compatibility policy

- Preserve policy-file shape unless a field is currently ignored or unsafe.
- For ignored or unsafe fields, reject them with a migration error rather than silently changing semantics.
- Preserve live `subagent` behavior while Agent Runs are introduced behind an adapter.
- Keep command names stable where the behavior remains equivalent.
- Commands whose guarantees change from advisory to enforced should announce the change once per upgraded installation.

### Rollback policy

- Every phase must be revertible without data migration where possible.
- New run-store records use a version field.
- Readers ignore unsupported future versions safely.
- Governance cutovers retain the previous adapter until parity tests pass, then remove it in the same phase.
- Do not maintain two active decision engines after cutover.

### Feature flags

Use flags only for risky runtime cutovers, not permanent dual systems:

- `THANOS_AGENT_RUNS_V2`
- `THANOS_GOVERNANCE_RUNTIME_V2`
- `THANOS_JURY_RUNTIME_V2`
- `THANOS_WAVES_RUNTIME_V2`

Flags default off during development, on in CI parity tests, then on by default for one release. Remove each flag after the stability window.

## Verification Matrix

| Area | Unit | Integration | Fault injection | Property/adversarial | Performance |
|---|---:|---:|---:|---:|---:|
| Governance | Required | Required | Required | Required | Required |
| Agent Runs | Required | Required | Required | Required | Required |
| Evidence | Required | Required | Required | Required | Optional |
| Jury/WAVES | Required | Required | Required | Required | Required |
| MCP | Required | Required | Required | Required | Required |
| Installer | Required | Required | Required | Optional | Optional |
| Audit/telemetry | Required | Required | Required | Required | Required |
| Session lifecycle | Required | Required | Required | Optional | Required |

## Definition of Done

The program is complete when all of the following are true:

1. `src/index.ts` is a thin composition root under 250 lines.
2. Governance decisions flow through one Governance Runtime.
3. Every writer is isolated fail closed and returns a durable patch or commit handoff.
4. Every subagent execution is a bounded Agent Run with cancellation and durable state.
5. Child and MCP results are runtime-validated before use.
6. Project MCP startup is governed before execution.
7. Local-only mode prevents tested remote egress paths.
8. Assistant prose cannot satisfy verification criteria.
9. Every passing criterion links to exact validated evidence.
10. Exactly one Continuation Arbiter controls follow-up turns.
11. Review Jury and WAVES guarantees are enforced by runtime code.
12. Audit, telemetry, scanner, and error outputs pass synthetic-secret leak tests.
13. Role policy and model routing each have one source of truth.
14. Strict TypeScript covers all external and process boundaries.
15. CI includes hermetic integration, fault-injection, installer, security, and performance gates.
16. The measured SLOs pass for two consecutive releases.

## Recommended First Execution Batch

Start with this narrowly scoped batch before the larger refactor:

1. Task 0.2: split CI and add timeouts.
2. Task 1.1: fail closed on writer isolation.
3. Task 1.3: fix sensitive Git reads.
4. Task 1.4: central redaction and scanner safety.
5. Task 1.8: OAuth state and callback hardening.
6. Task 1.7: installer identity, tag, and lockfile enforcement.

These changes are independent enough to review separately, close concrete vulnerabilities, and create reliable gates for the subsequent Agent Run and runtime-module work.

## Expected Outcome

After this plan, Thanos should feel smaller despite doing more. Models should encounter fewer overlapping instructions and more deterministic tool behavior. Operators should receive better output because:

- Specialists run with reliable context and authority.
- Writers cannot corrupt or lose parent work.
- Evaluators judge real evidence rather than confident prose.
- Review workflows cannot silently skip required critics.
- MCP integrations have explicit identities and trust decisions.
- Continuations stop predictably at budgets and user boundaries.
- The critical path is measured and bounded.
- The system has fewer concepts that each model must infer correctly.

The quality improvement comes primarily from making the harness enforce the workflow, not from asking every model to follow a more elaborate prompt.
