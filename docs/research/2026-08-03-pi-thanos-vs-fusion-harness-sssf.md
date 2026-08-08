# Pi + Thanos compared with Fusion Harness and Super Simple Software Factory

**Date:** 2026-08-03 <br>
**Scope:** Source-level review of the local Thanos repository and the two requested external repositories. This is an architectural/workflow assessment, not an implementation plan.

## Executive conclusion

Thanos is already the stronger **governance and acceptance harness**. It has capabilities-based authorization, explicit work contracts, run grants, parent-owned integration, journaled Waves state, independent review, SpecEngine acceptance, hostile-MCP/security tests, and a broad TypeScript test surface.

The two Disler repositories are valuable for a different reason:

- **Fusion Harness** demonstrates a compact, high-feedback **model-fusion and executable-gate loop**: independent model perspectives, a fresh synthesis agent, a validator-authored gate before implementation, baseline red/green evidence, verbatim machine feedback, same-session repair, and strong live telemetry.
- **Super Simple Software Factory (SSSF)** demonstrates a clear, inspectable **phase runtime**: workflows are short Python programs, every phase is typed and fail-by-default, handoffs are structured envelopes, known checks run as deterministic code, sessions are resumable, and JSONL + SQLite make runs queryable while they execute.

What Thanos lacks is therefore not more agent roles or more policy. Its biggest opportunity is an **operator-facing execution plane** that makes each run, phase, artifact, gate, process, retry, cost, and recovery decision visible and queryable—while preserving Thanos’s stronger safety model.

The recommended direction is:

> Keep Thanos as the authority plane; borrow Fusion’s pre-build executable acceptance loop and SSSF’s phase/event observability, but reject their unsafe write, shell, credential, commit, and isolation shortcuts.

---

## Method

### Local repository

Reviewed source, tests, ADRs, governance docs, runtime wiring, active plans, recent history, and current validation surfaces in `/home/nochaserz/.pi`.

Repository inventory at review time:

- 389 tracked files
- 142 source files / 17,679 source lines
- 150 test files
- 43 documentation files, including 22 ADRs
- Major source areas: runtime, governance, goal, spec, workflows, MCP, permissions, security, observability, delegation, and agents

Validation run during this review:

- `bun run typecheck`: **passed**
- `bun run lint`: **passed**
- `bun run test`: exceeded the 100-second bridge budget; many suites had passed, but the run did not reach a terminal summary, so this report does **not** claim the full suite passed
- `bun run measure`: **passed**
  - cold import: 8,252 ms median
  - prompt overhead: ~903 cached-prefix tokens + ~292 per-turn tokens
  - agent roster contribution: ~541 prefix tokens

### External repositories

The repositories were shallow-cloned and inspected at these revisions:

- [`disler/fusion-harness@5852f2e`](https://github.com/disler/fusion-harness/tree/5852f2ed4f5f064a368d83d2dabad84fe6bfa0b4)
- [`disler/super-simple-software-factory@de31374`](https://github.com/disler/super-simple-software-factory/tree/de31374882e7a4e3e5b7bb9bd09e69dc2f779356)
- SSSF’s populated [`example` branch](https://github.com/disler/super-simple-software-factory/tree/example) was also inspected

The review covered implementation source, prompt templates, workflow scripts, agent configuration, gates, permission logic, observability, example artifacts, and failure behavior—not only README files.

Detailed working reports:

- `/tmp/pi-thanos-local-review.md`
- `/tmp/fusion-harness-review.md`
- `/tmp/super-simple-software-factory-review.md`

---

## 1. Current Thanos architecture

Thanos is a governed Pi distribution, not merely a prompt collection.

### Strongest shipped mechanisms

1. **One composition root** <br>
   `src/runtime/register-harness.ts` connects permissions, policy, delivery, SpecEngine, goals, workflows, MCP, session guards, commands, and lifecycle hooks.

2. **Authority is code-owned** <br>
   Mutation is controlled by capabilities, approved work-contract revisions, run grants, delivery policy, spec scope, and parent/child identity—not by role names or prompt promises.

3. **Completion authority is hierarchical** <br>
   A worker can claim completion, but SpecEngine decides whether evidence satisfies the contract. Waves additionally requires revision-bound yield, an independent jury, and final acceptance.

4. **Single-writer, parent-owned integration** <br>
   Investigation and review may fan out, but the parent owns integration. This is materially safer than shared-working-tree multi-writer orchestration.

5. **Evidence is tied to behavior** <br>
   Verification supports expected executables, arguments, targets, required/any-of evidence, diff ground truth, and advisory degradation when evidence would otherwise be impossible.

6. **Durable logical workflow state** <br>
   Waves journals plans, node progress, evidence references, attempts, counters, lineage, and revision identity without serializing ephemeral mutation grants.

7. **Real security boundaries** <br>
   The repository includes tests for hostile MCP servers, yolo limits, delivery trust splits, snapshot behavior, launcher security, authorization bypasses, and role narrowing.

8. **Broad validation surface** <br>
   Tests map closely to source modules and include prompt boundaries, integration seams, performance budgets, workflow restoration, approval, and evidence verification.

### Current local gaps

#### A. The operator cannot see the workflow as clearly as the runtime can

Thanos has a harness evolution ledger and subagent artifacts, but no unified run view comparable to SSSF’s sessions/phases/events/envelopes/gates/processes model. The runtime knows a great deal; the operator must reconstruct it from logs, session entries, status commands, and artifacts.

#### B. Recovery is fail-safe but too quiet

The pre-critical snapshot is deliberately best-effort. It misses untracked-only state, collapses Git failures to `false`, and its caller discards the result. A critical operation can continue without an operator-visible recovery warning.

#### C. Restored artifact references are labels until revalidated

Waves preserves artifact path and hash references, but downstream prompts receive the reference rather than verified current contents. Artifact existence and hash should be rechecked at every consumption boundary.

#### D. Workflow failures are not normalized at every seam

The workflow runner expects delegated calls to return typed outcomes. An unexpected promise rejection can escape the structured workflow model instead of becoming a node-level failed result.

#### E. Permission UX is more complex than the enforcement model needs

Operators currently reason across delivery mode, autonomy, yolo, policy preset, spec scope, and temporary grants. Active design documents acknowledge this overlap.

#### F. Documentation has truth drift

`docs/governance.md` describes delivery modes as pinning presets, while the repository’s own permission-surface analysis says that mapping is not live. `docs/plans/` also contains completed plans despite the project’s live-plans-only rule.

---

## 2. Fusion Harness: what it actually does

Fusion Harness is a single Pi extension centered on three commands:

- `/fusion`: independent ARCHITECT and BUILDER answers, followed by a fresh FUSION synthesis
- `/auto-validate`: validator designs a Python gate, builder implements, the gate runs, and failures feed a bounded repair loop
- `/opinion`: side-by-side independent answers without synthesis

The load-bearing implementation is the 2,507-line [`fusion-harness.ts`](https://github.com/disler/fusion-harness/blob/5852f2ed4f5f064a368d83d2dabad84fe6bfa0b4/extensions/fusion-harness/fusion-harness.ts).

### Mechanisms worth learning from

#### 1. Independent perspectives followed by fresh synthesis

`/fusion` runs two source agents independently, then gives both outputs to a fresh synthesis session. The synthesizer does not inherit either source transcript, reducing anchoring and “first answer wins” behavior.

Source: [`fusion-harness.ts#L1873-L1893`](https://github.com/disler/fusion-harness/blob/5852f2ed4f5f064a368d83d2dabad84fe6bfa0b4/extensions/fusion-harness/fusion-harness.ts#L1873-L1893).

**Thanos application:** use this selectively for architecture decisions and plan synthesis. Keep the current oracle/reviewer distinction, but provide an explicit “independent proposals → fresh synthesis” workflow recipe.

#### 2. Acceptance is authored before implementation

`/auto-validate` asks the validator to write an executable gate before the builder works, then runs it against the baseline. This creates a concrete definition of done and establishes whether the gate can distinguish pre-change from post-change behavior.

Source: [`fusion-harness.ts#L2008-L2108`](https://github.com/disler/fusion-harness/blob/5852f2ed4f5f064a368d83d2dabad84fe6bfa0b4/extensions/fusion-harness/fusion-harness.ts#L2008-L2108).

**Thanos application:** add an optional executable-acceptance criterion for high-risk or behaviorally testable work. The criterion should be approved with the work contract and run before the writer starts.

#### 3. Machine output remains the correction source

Gate failures are passed verbatim to the builder rather than paraphrased by another model.

Source: [`USER_PROMPT_CORRECTION.md#L1-L13`](https://github.com/disler/fusion-harness/blob/5852f2ed4f5f064a368d83d2dabad84fe6bfa0b4/extensions/fusion-harness/USER_PROMPT_CORRECTION.md#L1-L13).

**Thanos application:** deterministic validation should produce a typed failure envelope containing the exact command, exit code, stdout/stderr tail, and affected criterion. A fix worker should consume that envelope directly.

#### 4. Same-session repair preserves working memory

The first builder round forks the host session; later rounds resume the same builder child.

Source: [`fusion-harness.ts#L2110-L2140`](https://github.com/disler/fusion-harness/blob/5852f2ed4f5f064a368d83d2dabad84fe6bfa0b4/extensions/fusion-harness/fusion-harness.ts#L2110-L2140).

**Thanos application:** preserve session lineage for an implementation/fix role inside one bounded milestone. Continue using fresh context for independent reviewers and evaluators.

#### 5. Strong live telemetry

The extension streams role, model, state, elapsed time, tokens, cost, context occupancy, tool flow, and output in a two-column TUI. Artifacts are saved per run under a temporary directory.

**Thanos application:** project existing subagent lifecycle artifacts into one parent-owned workflow view instead of adding more status commands.

### Fusion Harness problems Thanos should not copy

1. **Validator path scope is prompt-only.** `VALIDATOR_TOOLS` includes unrestricted `write`; the prompt says to write only the gate path, but the tool layer does not enforce that path.
2. **“Read-only” workers have `bash`.** `OPINION_TOOLS` excludes edit/write but includes arbitrary shell execution.
3. **`/fusion` can run unrestricted agents concurrently in one working tree.** Tool matrices and comments do not establish safe filesystem isolation.
4. **A baseline gate that already passes is only a warning.** The builder may still run and receive a final accepted pass. A non-discriminating gate should not authorize acceptance.
5. **Artifact write failures are swallowed.** Observability can silently disappear.
6. **Architect, validator, and triage share persistent role history.** This risks role contamination.
7. **No automated test suite, typecheck contract, or CI was present at the reviewed revision.**
8. **The entire engine is concentrated in one 2,507-line module.** It is easy to demo and difficult to evolve safely.

---

## 3. SSSF: what it actually does

SSSF is a skill that stamps a small software factory into a repository. The stamped runtime contains:

- 12 starter ADW workflow scripts
- five configured roles: planner, builder, scout, reviewer, documenter
- a phase runner
- Pi subprocess adapter
- typed Pydantic envelopes
- deterministic quality runners
- claim gates
- post-hoc write-permission checks
- Git helpers
- JSONL + SQLite tracing
- a Vue visualizer

The full lifecycle is visible in [`adw_simple_sdlc.py`](https://github.com/disler/super-simple-software-factory/blob/de31374882e7a4e3e5b7bb9bd09e69dc2f779356/.claude/skills/sssf/templates/adws/adw_simple_sdlc.py):

`request → plan → commit plan → build → test/fix loop → review/revise loop → retest → commit code → capture diff → document → commit docs`

### Mechanisms worth learning from

#### 1. One explicit phase primitive

Every workflow phase enters through `run.phase(PhaseParams(...))`. A phase starts as running, defaults to failure on exception, records start/end/error events, updates SQLite, and finalizes session state consistently.

Source: [`runner.py#L59-L113`](https://github.com/disler/super-simple-software-factory/blob/de31374882e7a4e3e5b7bb9bd09e69dc2f779356/.claude/skills/sssf/templates/adws/adw_modules/runner.py#L59-L113).

**Thanos application:** define a small canonical `WorkflowPhase` interface behind Waves and ordinary goal work. The interface should own start/end state, evidence, retries, usage, artifacts, and failure normalization.

#### 2. Phase success and run acceptance are separate

`Run.finish()` requires both all phases to have completed and the workflow-specific acceptance condition to hold. This prevents “the test phase ran” from being confused with “tests passed.”

Source: [`runner.py#L115-L148`](https://github.com/disler/super-simple-software-factory/blob/de31374882e7a4e3e5b7bb9bd09e69dc2f779356/.claude/skills/sssf/templates/adws/adw_modules/runner.py#L115-L148).

**Thanos application:** preserve the existing hierarchical completion model, but expose this distinction explicitly in workflow status: execution complete, evidence complete, independently reviewed, accepted.

#### 3. Typed envelopes and same-session correction

Agent output is parsed into a concrete Pydantic type. Malformed JSON and failed gates generate corrections sent to the same Pi session; retries are bounded.

Source: [`agents.py#L69-L190`](https://github.com/disler/super-simple-software-factory/blob/de31374882e7a4e3e5b7bb9bd09e69dc2f779356/.claude/skills/sssf/templates/adws/adw_modules/agents.py#L69-L190).

**Thanos application:** extend the existing V2 delegation envelope so every workflow phase reports a uniform typed payload: status, summary, artifacts, changed paths, evidence, validation, residual risks, usage, and decisions requiring parent approval.

#### 4. Known validation is code, not an agent

SSSF intentionally has no tester agent. Tests, lint, typecheck, and build are deterministic command phases. Results are converted into envelopes for the builder repair loop.

Source: [`quality.py#L183-L221`](https://github.com/disler/super-simple-software-factory/blob/de31374882e7a4e3e5b7bb9bd09e69dc2f779356/.claude/skills/sssf/templates/adws/adw_modules/quality.py#L183-L221).

**Thanos application:** let the parent/runtime execute known project validation commands. Use agents to diagnose ambiguous failures, not to rediscover or merely invoke stable commands.

#### 5. Queryable event model

SSSF writes raw JSONL plus a SQLite mirror in WAL mode. Its schema includes sessions, phases, events, envelopes, gate results, processes, agent sessions, token/cost totals, retries, context occupancy, and artifact claims.

Source: [`tracer.py#L1-L115`](https://github.com/disler/super-simple-software-factory/blob/de31374882e7a4e3e5b7bb9bd09e69dc2f779356/.claude/skills/sssf/templates/adws/adw_modules/tracer.py#L1-L115).

**Thanos application:** this is the highest-value transfer. Build a projection from existing session/workflow/subagent events into a queryable run model; do not create a second authority store.

#### 6. Resumable role sessions

An `adw_id` owns a session directory and `agent_map.json`; repeated workflows can resume each role’s Pi session while continuing the phase sequence.

**Thanos application:** add logical milestone/session identity to ordinary goal work and Waves fix loops, while keeping reviewers fresh.

#### 7. Workflows remain readable programs

Each starter workflow is roughly 40–184 lines. The control flow is ordinary code rather than a hidden prompt convention or an over-general graph language.

**Thanos application:** add a small recipe catalog (`quick-fix`, `standard`, `review-heavy`, `investigation`, `ui-verify`) implemented through one runtime interface. Avoid a visual workflow editor until usage proves it necessary.

### SSSF problems Thanos should not copy

1. **Permission checks happen after agent execution and are skipped on several error paths.** If Pi execution or parsing raises before `permissions.enforce()`, unauthorized writes may remain. Enforcement belongs in a `finally`-grade boundary and ideally before the write.
2. **Quality commands ship as success-exiting placeholders.** Until replaced, test phases are explicit theater.
3. **`commit_all()` stages unrelated pre-existing changes.** Commit provenance is not restricted to the phase’s authorized path set.
4. **Write fingerprints use diff counts, not exact content/blob identity.** Equal line counts can hide content replacement.
5. **Agents inherit operator credentials and have unrestricted process/network capability.** This is not a sandbox.
6. **`diff_matches_claims` only checks that claimed paths exist.** It does not compare claims to the actual baseline-to-current diff.
7. **A nonzero Pi process can be treated as usable if it emitted text.** Process success and parseable output must remain distinct.
8. **The visualizer exposes prompts and offers a write endpoint without authentication.** It must be bound and authenticated before remote use.
9. **The reviewed revision had no automated test/CI safety net.**
10. **Git and shell operations use broad subprocess authority, including `shell=True` in gate execution.**

---

## 4. Comparative matrix

| Capability | Thanos | Fusion Harness | SSSF | Recommended owner |
|---|---|---|---|---|
| Capability-based mutation authority | Strong | Weak/prompt-scoped | Post-hoc allowlist | Thanos |
| Explicit work contract | Strong | Gate prompt/script | Workflow prompt/envelope | Thanos |
| Independent model diversity | Available via reviewers/oracle | Excellent and central | Configurable roles | Add a Thanos recipe |
| Pre-build executable acceptance | Partial via contract criteria | Excellent concept, unsafe edge cases | Plan then deterministic tests | Add optional Thanos gate phase |
| Deterministic validation runner | Evidence-oriented but distributed | Python gate subprocess | Strong phase primitive | Centralize in Thanos runtime |
| Typed handoffs | V2 delegation/evidence | Mostly prose/files | Strong Pydantic envelopes | Deepen Thanos V2 envelope |
| Same-session repair | Subagent resume exists | Strong builder loop | Strong role sessions | Use selectively |
| Fresh independent review | Strong | Validator shares architect state | Reviewer has persistent role state | Keep Thanos behavior |
| Single-writer isolation | Strong design principle | Unsafe shared cwd possibilities | One configured builder, no sandbox | Thanos |
| Worktree isolation | Supported by Pi subagents | Absent | Absent | Thanos |
| Queryable run telemetry | Partial/distributed | Strong TUI, temporary artifacts | Strong JSONL/SQLite/UI | Borrow SSSF projection |
| Token/cost/context by phase | Available in child artifacts, not unified | Excellent live display | Persisted per session/agent | Add unified projection |
| Process tracking/cancel | Pi-subagents runtime | Stopper/child process | SQLite process registry | Unify existing Pi data |
| Automated test/CI safety net | Strong | Absent | Absent | Thanos |
| Security/hostile-input tests | Strong | Absent | Absent | Thanos |
| Artifact integrity | Hash references but consumption gap | Temporary files, weak error handling | Existence/size checks | Harden Thanos hashes |

---

## 5. Recommended Thanos roadmap

### P0 — Correct current truth and failure seams

1. **Fix delivery-mode/preset documentation or wire the mapping.** <br>
   Do not let `no-mistakes` imply a policy ceiling it does not activate.

2. **Make snapshot outcome visible.** <br>
   Record attempted/succeeded/failed/skipped, include what was not captured, and warn before a critical operation proceeds without a recovery point.

3. **Normalize delegated exceptions.** <br>
   Every node must end as a typed success/failure/cancelled/timeout outcome; raw promise rejection must not escape the workflow state machine.

4. **Revalidate artifact references on consumption.** <br>
   Verify path, existence, current SHA-256, producer, phase, and revision. Reject stale evidence explicitly.

5. **Clean plan-state hygiene.** <br>
   Enforce the required `**Status:**` line and remove completed plans after durable decisions move to ADRs.

### P1 — Add an execution/evidence projection

Create one queryable run projection backed by existing authoritative events. Suggested records:

- run: request/goal/workflow, repository, revision, status, start/end, totals
- phase: kind, owner, dependencies, status, attempts, start/end
- delegation: agent, model, context mode, session lineage, capabilities
- evidence: criterion, command/test/diff/manual source, pass/fail, artifact refs
- artifact: path, hash, size, producer phase, revision, verified-at
- process: child ID/PID when available, command class, status, stop reason
- usage: input/output/cache/reasoning tokens and cost by phase
- recovery: snapshot/journal/restore result

Expose it first through a concise `/run status` or enhanced `/waves status`; add a visualizer only after the schema proves useful.

**Important:** this should be a projection, not a competing source of truth. Pi session journals, SpecEngine, Git, and subagent lifecycle artifacts remain authoritative.

### P1 — Add deterministic validation phases

Introduce a deep module such as:

```ts
runValidationPhase({
  criterionId,
  command,
  cwd,
  timeoutMs,
  allowedExecutables,
  expectedTargets,
  baselinePolicy,
}): ValidationEnvelope
```

The module should:

- execute known commands directly;
- capture exact argv, cwd, timeout, exit code, and bounded output;
- associate evidence with a criterion;
- distinguish execution error from test failure;
- feed the exact envelope to one fix worker;
- rerun after any relevant revision;
- persist usage-free deterministic evidence.

### P1 — Add optional baseline-red acceptance

For high-risk behavior changes, allow an evaluator or the parent to author an executable gate before implementation.

Unlike Fusion Harness:

- the gate’s write path must be technically scoped;
- gate execution must use an allowlisted command contract, not arbitrary `uv run` by default;
- a gate that passes before implementation is **invalid or informational**, never acceptance-authorizing;
- the builder cannot edit the gate;
- gate repair creates a new contract revision requiring approval;
- one revision cannot silently move the goalposts.

### P2 — Deepen the delegation result envelope

Standardize every child result around:

```text
status
summary
changedPaths
artifacts[{path, sha256, size}]
evidence[{criterionId, kind, command, result}]
validation[{command, exitCode, duration}]
usage
residualRisks
decisionsNeeded
```

Thanos already has V2 delegation evidence and generic result contracts. The improvement is to make the envelope the universal phase interface and observability payload.

### P2 — Add a small workflow recipe catalog

Suggested initial recipes:

- `quick-fix`: implement → focused validation → review if risk threshold requires
- `standard`: contract → implement → deterministic checks → independent review → fix → acceptance
- `review-heavy`: independent plan proposals → fresh synthesis → implement → multi-angle jury
- `investigation`: parallel read-only evidence → synthesis → no mutation
- `ui-verify`: implement → deterministic checks → browser validator → review

Keep recipes as readable TypeScript configuration/programs using one runtime. Do not build a general visual graph editor yet.

### P2 — Make session continuity role-specific

- implementation/fix role: resume inside a bounded milestone
- reviewer/evaluator/security critic: fresh context by default
- oracle: forked context when decision history matters
- synthesizer: fresh context with explicit source artifacts

This combines Fusion/SSSF continuity benefits with Thanos’s independence guarantees.

### P3 — Operator UI, only after the data model settles

A useful UI should answer:

- What is running?
- Which phase is blocked and why?
- What evidence is missing?
- What changed since the last accepted revision?
- Which agent/model/session produced each artifact?
- How much did each phase cost?
- Was the recovery snapshot and workflow journal persisted?
- Can this phase be retried, resumed, cancelled, or handed off safely?

Avoid exposing raw prompts, secrets, or write endpoints without authentication.

---

## 6. What not to build

1. **Do not replace SpecEngine with generated Python gates.** Executable gates are one evidence adapter, not the acceptance authority.
2. **Do not run normal writers concurrently in one working tree.** Preserve single-writer integration or isolated worktrees.
3. **Do not call a role read-only while granting arbitrary bash.** Enforce capabilities at the tool/command/path/network layers.
4. **Do not use post-hoc rollback as the primary permission model.** Prevention remains primary; detection and repair are defense in depth.
5. **Do not ship placeholder checks that exit zero.** Missing validation configuration should be explicit and acceptance-blocking when required.
6. **Do not stage or commit the entire dirty tree.** Commit only authorized, phase-attributed paths after verifying baseline provenance.
7. **Do not create a second workflow truth database.** Build projections from journals, Git, SpecEngine, and subagent artifacts.
8. **Do not add more top-level permission toggles.** Consolidate the operator surface around approval posture and containment while preserving immutable policy floors.
9. **Do not build a visual workflow editor before repeatable recipes and event schemas prove the need.**
10. **Do not reuse implementation context for independent acceptance review.**

---

## 7. Target architecture

The strongest combined architecture is:

```text
User goal
  ↓
Work contract + acceptance criteria (Thanos / SpecEngine)
  ↓
Optional independent plans → fresh synthesis (Fusion pattern)
  ↓
Optional executable gate authored before mutation
  ↓ baseline must discriminate
Parent-owned workflow runtime
  ├─ deterministic code phases (SSSF pattern)
  ├─ one resumable writer/fix lineage
  ├─ fresh independent reviewers
  └─ typed phase envelopes
  ↓
Revision-bound evidence manifest
  ↓
Independent jury
  ↓
SpecEngine acceptance
  ↓
Operator-visible run/phase/evidence projection
```

The deep module is the **parent-owned workflow runtime**. Its interface should stay small: start/restore a workflow, run a phase, record evidence, yield a revision, review, accept, pause/resume/cancel/handoff. Agent spawning, session continuity, deterministic commands, artifact hashing, retries, usage accounting, and observability stay behind that interface.

---

## Final assessment

Thanos does not need to become Fusion Harness or SSSF. It already solves the harder safety and authority problems that those projects leave open.

The transferable lessons are narrower and more valuable:

1. **From Fusion:** independent model diversity, fresh synthesis, pre-build executable acceptance, baseline discrimination, verbatim failure feedback, and excellent live telemetry.
2. **From SSSF:** one phase primitive, typed envelopes, deterministic command phases, resumable role sessions, readable workflow recipes, and queryable run state.
3. **From Thanos:** retain capabilities-based authority, explicit contracts, single-writer integration, worktree support, independent review, revision-bound evidence, SpecEngine acceptance, and real tests.

If only one improvement is pursued next, it should be the **unified execution/evidence projection**. It will expose where time, retries, cost, missing evidence, recovery failures, and workflow friction actually occur. That data will then tell you whether baseline gates, recipe selection, richer session resumption, or UI investment delivers the next highest return.
