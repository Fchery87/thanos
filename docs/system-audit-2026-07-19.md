# Thanos System Audit

**Assessment date:** July 19, 2026  
**Scope:** Executable code, configuration, scripts, workflows, manifests, and tests only. Project Markdown documentation was intentionally excluded from the audit.

## Executive Assessment

The system has a strong governance foundation and unusually good coverage of policy, subagents, specifications, goals, MCP, memory, review, and delivery modes. The problem is not a lack of capability. It is too many partially overlapping control systems composed through one oversized runtime file.

The current harness is sophisticated, but several guarantees are aspirational rather than enforced. The highest-risk issue is that some failures in isolation, verification, and orchestration fail open.

## Highest-Priority Findings

### P0: `src/index.ts` is a god module

`src/index.ts` is 1,998 lines and owns:

- Startup and shutdown
- Policy and delivery state
- MCP initialization and commands
- Permission gates
- Tool governance
- Spec verification
- Goal continuation
- Todo, Ask, and review tools
- Model and thinking commands
- Memory injection
- Welcome UI
- Subagent dispatch
- Lens integration

This is the primary source of congestion. It is not merely a large composition root; it contains most of the runtime implementation.

**Recommendation:** Reduce `src/index.ts` to a thin composition root, ideally under 150-250 lines.

Extract:

```text
src/runtime/session-runtime.ts
src/runtime/governance-runtime.ts
src/runtime/continuation-runtime.ts
src/runtime/register-lifecycle.ts
src/runtime/register-commands.ts
src/runtime/register-shortcuts.ts
src/runtime/register-tools.ts
src/interaction/register-tools.ts
src/mcp/command-service.ts
```

Do not simply move blocks into arbitrary helper files. Establish two deep modules first:

1. `SessionRuntime`
2. `GovernanceRuntime`

Everything else should become an adapter around those seams.

### P0: Writer-agent isolation fails open

`src/agents/task-tool.ts:174-181`

If worktree creation fails, the code catches the error and continues:

```ts
catch {
  /* fall back: run in process.cwd() */
}
```

That means a writer agent such as `build` or `designer` can edit the parent checkout when isolation fails.

This is a direct security and correctness violation.

**Recommendation:**

- Fail closed when a writing agent cannot obtain a worktree.
- Never spawn a writing agent with `cwd: process.cwd()`.
- Return a structured task failure explaining that isolation could not be established.
- Add a regression test for worktree creation failure.

### P0: Writer changes are deleted

`src/agents/task-tool.ts:225-234`

Writer worktrees are removed after execution, but there is no patch extraction, commit handoff, artifact export, or merge process. Successful writer output can therefore be deleted.

**Recommendation:** Pick one explicit result mechanism:

- Return a patch artifact.
- Return a commit SHA from the isolated worktree.
- Return a structured change manifest and require parent-side merge.
- For background tasks, publish the patch or commit as part of the result contract.

Until this is implemented, the dormant legacy task path should be removed rather than exposed through `THANOS_LEGACY_TASK=1`.

### P0: Verification can be satisfied by unrelated activity

`src/spec/evidence.ts:75-103`

Current evidence rules treat:

- Any successful Bash call as valid command or test evidence.
- Any Bash command containing `test`, `vitest`, `pytest`, `playwright`, or `bats` as test evidence.
- Any successful edit as valid diff evidence.
- Any non-empty output as manual evidence.

`src/spec/engine.ts:64-69` also records assistant output as passing manual evidence.

Examples that can incorrectly satisfy criteria:

```bash
printf test
echo done
git grep vitest
```

A successful edit to the wrong file can satisfy a diff criterion.

**Recommendation:**

- Remove assistant prose as automatic evidence.
- Require structured manual evidence.
- Bind diff evidence to expected paths and the actual repository diff.
- Bind test evidence to executable identity, arguments, exit code, and test results.
- Require criteria to include target paths or expected commands.
- Add false-positive tests.

### P0: MCP project configuration executes before governance

`src/mcp/config.ts:45-57` loads project configuration, and `src/mcp/manager.ts:94-120` starts configured servers during session startup.

A project can cause a local process to start simply by providing `mcp.json`. The tool-call policy gate happens only after the server has started.

This can expose environment variables, initiate network access, or execute arbitrary local commands before policy applies.

**Recommendation:**

- Treat project MCP configuration as untrusted.
- Do not auto-start project-defined servers without approval.
- Require explicit server approval or a trusted-project marker.
- Allowlist command paths and server identities.
- Pass a minimal environment instead of the entire process environment.
- Govern server startup as its own capability, separate from MCP tool calls.

## Governance Problems

### Sensitive-read bypass through Git revision syntax

`src/permissions/risk.ts:77-97`

`git show HEAD:.env` can be classified as low risk because the sensitive path is embedded in the revision/path syntax and is not matched as `.env`.

**Recommendation:** Parse Git revision/path syntax and inspect the path after `:`. Treat sensitive Git object paths as sensitive.

### Local-only mode does not fully govern network egress

`src/governance/delivery-overlay.ts` and `src/hooks/before-tool.ts:119-130` allow recognized tools automatically under unattended autonomy.

The current push guard catches `git push`, but local-only delivery does not comprehensively block:

- `curl`
- `wget`
- `scp`
- `rsync`
- SSH transfers
- Package publishing
- Other upload or network commands

**Recommendation:** Define an explicit egress capability and deny network or upload families in local-only mode. Do not infer local-only behavior from only Git push rules.

### Audit logging stores raw sensitive targets

`src/audit/logger.ts:8-10` writes events directly. `src/governance/tool-call.ts:44-52` uses raw Bash commands as audit targets.

Commands may contain:

- API keys
- Bearer tokens
- Passwords
- Signed URLs
- Secret assignments
- Sensitive paths

`src/security/scanner.ts:31` also exposes the first 60 characters of matching secret lines.

**Recommendation:**

- Centralize audit redaction.
- Redact credentials, authorization headers, token-like values, signed query parameters, and secret paths.
- Never show secret previews.
- Bound rationale size and make sensitive rationale persistence opt-in.
- Use safe target identifiers instead of raw commands by default.

### `yolo` is an intentionally extreme bypass

`src/index.ts:1547-1576` explicitly bypasses policy, permission checks, and confirmation.

This may be acceptable as a personal escape hatch, but it is incompatible with a team-grade governance guarantee.

**Recommendation:**

- Keep it only as an explicitly personal and local mode.
- Make it impossible in team, CI, and unattended presets.
- Require a process or session marker and prominent audit event.
- Consider removing it entirely from unattended contexts.

### Headless policy configuration is not authoritative

`src/policy/schema.ts` accepts `headless.defaultDecision`, but `src/hooks/before-tool.ts:133-146` effectively blocks high-risk calls whenever UI is unavailable.

The configuration is accepted but not consistently enforced.

**Recommendation:** Centralize headless decision resolution. Either implement the configured behavior or reject incompatible policy values during schema validation.

## Subagent and Orchestration Problems

### Result contracts are not actually validated

`src/agents/result.ts:36-79` uses unchecked casts for:

- Status
- Findings
- Artifacts
- Escalations
- Metadata

Malformed child output can be accepted as an apparently valid contract.

**Recommendation:**

- Validate every field at the child boundary.
- Reject unknown statuses.
- Validate finding priority and line numbers.
- Validate artifact containment, existence, and byte count.
- Bound metadata size.
- Convert invalid contracts into explicit `error` results.

### Background execution lacks a lifecycle protocol

`src/agents/task-tool.ts:206-303` has no robust handling for:

- Cancellation
- Stale jobs
- Crashed processes
- Partial result files
- Atomic publication
- Parent-session disappearance
- Process descendants
- Result retention

Background results are also unbounded.

**Recommendation:** Introduce a run record:

```text
queued
running
success
error
timeout
cancelled
stale
```

Each run should have:

- Stable run ID
- PID or process-group metadata
- Start and end timestamps
- Requested and effective context mode
- Cancellation endpoint
- Atomic result publication
- Bounded retention
- Explicit failure state

### Subagent metadata is globally overwritten

`src/agents/transcripts.ts:14-16` always writes:

```text
.harness/subagents/metadata.json
```

Concurrent and sequential runs overwrite one another.

**Recommendation:**

```text
.harness/subagents/<run-id>/metadata.json
.harness/subagents/<run-id>/result.json
.harness/subagents/<run-id>/artifacts/
```

Use atomic writes and retain the run ID across all records.

### Context-mode audit can lie

`src/agents/context-mode.ts:21-24` falls back to fresh execution when forked mode lacks a parent session reference, but metadata still records `forked` as the mode.

**Recommendation:** Record both:

```ts
{
  requestedContextMode: "forked",
  effectiveContextMode: "fresh"
}
```

### Review Jury is prompt-only

`src/review/jury.ts` only generates instructions. The runtime does not enforce:

- Parallel critic execution
- Oracle execution
- Critic completion
- Finding aggregation
- Deduplication
- Verdict derivation
- Synthesis evidence

A model can skip all of these and still appear to complete the review.

**Recommendation:** Either implement the jury as a real runtime workflow or stop presenting it as enforced orchestration.

The runtime should own:

- Fixed critic roster
- Bounded concurrency
- Independent child runs
- Structured result collection
- Oracle challenge phase
- Deterministic synthesis
- Verdict derivation from findings
- Timeout and cancellation behavior

### WAVES is also prompt-only

`src/waves/plan.ts` and `src/waves/verify.ts` contain useful validation logic, but production code does not appear to invoke them. `/waves` primarily sends a prompt.

**Recommendation:** Implement a real WAVES runtime or simplify `/waves` into an explicitly model-directed planning prompt. Do not claim path ownership, width, depth, or handoff verification unless the runtime enforces them.

### Reviewer findings are not aggregated

`report_finding` state is local to each child process in `src/index.ts:1981-1995`. The parent does not automatically receive or aggregate those findings into its own review state.

**Recommendation:** Return findings in the subagent contract and aggregate them in the parent orchestration runtime. Do not rely on shared mutable in-process state across subprocesses.

## MCP Problems

### Reload can duplicate stale tools

`src/mcp/manager.ts:82-120` and `src/mcp/lifecycle.ts:114-120`

Reload disconnects clients, but registered Pi tools are not clearly deregistered. Reinitialization can register duplicate names or leave closures pointing at disconnected clients.

**Recommendation:**

- Track a registration generation.
- Deregister old tools where supported.
- Reject calls from stale generations.
- Clear manager state before reinitialization.
- Test reload twice with identical tool names.

### MCP startup is unbounded

`src/mcp/manager.ts:94-120` initializes all servers concurrently.

**Recommendation:** Cap startup concurrency, such as four servers, with per-server timeout and timing metrics.

### MCP stdio buffering is unbounded

`src/mcp/client.ts:71-93` accumulates data until a newline without a maximum buffer size.

**Recommendation:** Enforce a maximum frame size and terminate or report protocol overflow.

### OAuth state is not verified

`src/mcp/oauth.ts:299-322` generates state but does not compare the callback state against it.

**Recommendation:** Require exact state equality before exchanging the code.

### OAuth callback reflects unescaped HTML

`src/mcp/oauth.ts:100-105,132-136` interpolates query parameters into HTML.

**Recommendation:** HTML-escape the value or return plain text only.

## Maintainability Issues

### Multiple role catalogs

Role behavior is defined in several places:

- `src/agents/policy.ts`
- `src/governance/role-overlay.ts`
- `src/agents/registry.ts`
- `src/agents/model-routing.ts`
- `src/agents/task-tool.ts`

This is likely to drift.

**Recommendation:** Create one specialist catalog:

```ts
interface SpecialistProfile {
  id: SpecialistId;
  writes: boolean;
  executes: boolean;
  canDelegate: boolean;
  modelRoutable: boolean;
}
```

Derive worktree behavior, policy narrowing, model routing, delegation, and legacy compatibility from it.

### Lens Lite is overloaded

`src/lens/lite.ts` is 476 lines and combines:

- Input normalization
- Read tracking
- Edit tracking
- Secret scanning
- Policy behavior
- Diagnostics discovery
- Subprocess execution
- Project-root discovery
- UI registration

Split it into focused modules:

```text
src/security/edit-guard.ts
src/security/change-tracker.ts
src/diagnostics/runner.ts
src/diagnostics/project-discovery.ts
src/commands/lens.ts
```

### Model routing is duplicated

`src/agents/model-routing.ts` and `src/goal/evaluator-model.ts` independently parse and resolve model references.

**Recommendation:** Centralize:

```text
src/models/model-ref.ts
src/models/catalog.ts
src/models/routing.ts
```

Keep role-specific constraints as policy predicates.

### TypeScript strict mode is disabled

`tsconfig.json:6` has:

```json
"strict": false
```

This is especially dangerous at MCP, policy, subprocess, result-contract, and evidence boundaries.

**Recommendation:** Enable strict mode incrementally, starting with:

1. MCP adapters
2. Subagent result contracts
3. Policy loading and evaluation
4. Evidence generation
5. Hook event normalization

Replace casts with runtime validation.

## Performance and Reliability

### Audit I/O is on the tool critical path

`src/audit/logger.ts` performs `mkdir` and `appendFile` for each governed tool call.

**Recommendation:**

- Create one session-scoped logger.
- Serialize writes through a bounded queue.
- Use atomic append semantics.
- Define behavior when audit storage fails.
- Record queue and write latency.

### Critical snapshots are expensive

`src/index.ts:1736-1745` runs Git operations before critical Bash calls. This can add substantial latency to repeated edits and builds.

**Recommendation:**

- Coalesce snapshots by turn or dirty-tree state.
- Add a short timeout.
- Measure snapshot latency.
- Record snapshot failure explicitly.

### Startup scales poorly

`src/index.ts:319-327` sorts the complete session inventory on startup. MCP startup is also unbounded. Update checks have no single-flight protection.

**Recommendation:**

- Bound session enumeration.
- Add a single-flight update-check promise.
- Bound MCP initialization concurrency.
- Add startup benchmarks for large session and MCP inventories.

### Process cancellation is incomplete

`src/agents/task-tool.ts:215-223` only sends `SIGTERM`.

**Recommendation:**

- Spawn a process group.
- Terminate the group.
- Wait a bounded grace interval.
- Escalate to `SIGKILL`.
- Track descendants.
- Publish `timeout` or `cancelled` explicitly.

## Installer Problems

### Repository identity matching is too broad

`scripts/install.sh:93-100` accepts any remote containing `Fchery87/thanos`.

Require exact canonical host and repository identity after URL normalization.

### Mutable branch fallback violates release pinning

`scripts/install.sh:119-125` falls back to `master` if no release tag exists.

**Recommendation:** Fail closed unless the user explicitly supplies `THANOS_REF`.

### Install dependency resolution is not frozen

`scripts/install.sh:196-204` and `scripts/install.ps1:146-150` run unconstrained installs, unlike CI.

Use frozen-lockfile installs by default.

## What To Keep

These are strong foundations:

- Fresh context as the default for adversarial and read-only agents.
- Forked context restricted to continuity roles.
- Separate `interaction` capability.
- Role-based policy narrowing.
- Headless fail-closed behavior as the default direction.
- Goal-loop deferral so only one continuation driver runs.
- Session-local todos.
- Safe artifact filename containment.
- Worktree markers and garbage-collection concepts.
- Model override validation.
- Policy-first governance architecture.
- Separate spec, goal, review, and delegation concepts.

## What To Remove or Deprecate

### Remove now

- Automatic assistant prose as manual verification evidence.
- Silent writer fallback to the parent checkout.
- Unbounded raw secret previews.
- Prompt-only claims that Review Jury and WAVES are runtime-enforced.
- Duplicate role catalogs.
- Duplicate model-reference parsing.

### Deprecate

- `THANOS_LEGACY_TASK=1` unless worktree handoff, cancellation, result contracts, and artifact or commit delivery are complete.
- `yolo` in team, CI, and unattended modes.
- Project MCP auto-start without trust approval.
- Broad recognized-tool automatic approval under unattended autonomy.
- The overloaded `LensLite` facade.
- Any fallback that tells the model to rediscover a missing roster when the live roster is unavailable.

## Recommended Build Order

### Phase 1: Close fail-open security defects

1. Fail closed on writer worktree creation.
2. Implement writer patch or commit handoff.
3. Validate OAuth state.
4. Escape OAuth callback output.
5. Fix Git sensitive-path parsing.
6. Redact audit and scanner output.
7. Govern project MCP startup.
8. Block network egress in local-only mode.
9. Remove mutable installer fallback.
10. Enforce frozen dependency installation.

### Phase 2: Establish runtime seams

1. Extract `GovernanceRuntime`.
2. Extract `SessionRuntime`.
3. Reduce `src/index.ts`.
4. Create one specialist catalog.
5. Centralize model routing.
6. Split Lens Lite.

### Phase 3: Make orchestration real

1. Add validated subagent result contracts.
2. Add per-run directories and atomic publication.
3. Add cancellation and process-group cleanup.
4. Add result and artifact ownership validation.
5. Implement real Jury orchestration.
6. Implement real WAVES orchestration.
7. Aggregate reviewer findings in the parent.
8. Add lifetime autonomy budgets.

### Phase 4: Strengthen verification

1. Replace lexical evidence classification.
2. Tie evidence to paths, commands, exit codes, and diffs.
3. Add independent evaluator boundaries.
4. Add test, fault-injection, and property tests.
5. Add performance and leak gates.

### Phase 5: Improve operational quality

1. Add a session-scoped asynchronous audit queue.
2. Add MCP concurrency limits.
3. Add MCP reload generations.
4. Add MCP frame-size limits.
5. Add OAuth refresh single-flight behavior.
6. Add background-result retention and garbage collection.
7. Add startup and update single-flight caching.
8. Add CI timeouts and split test jobs.

## Current Quality Gate

The codebase has good unit-test breadth, but the verification pipeline is not yet a reliable release gate.

Observed issues:

- The full test command exceeded the available execution window.
- Focused suites pass but are slow.
- One installer test timed out.
- There is no dedicated MCP lifecycle or fault-injection gate.
- There is no subprocess cancellation or descendant-cleanup gate.
- There is no end-to-end Pi registration and tool-hook gate.
- There is no performance regression threshold.
- There are no property tests for policy, risk, or evidence classification.
- There is no installer matrix covering Linux and Windows behavior.

Add CI jobs for:

- Unit tests
- Strict type-boundary checks
- Installer fixture tests
- MCP fake-server lifecycle tests
- Subprocess cancellation and cleanup
- Security regression tests
- Hermetic Pi integration
- Performance benchmarks
- Dependency and install reproducibility

## Bottom Line

The harness does not need more features first. It needs fewer authoritative execution paths.

The central design should be:

```text
model request
  -> normalized governed operation
  -> policy and capability ceiling
  -> approval or denial
  -> isolated execution
  -> validated result
  -> privacy-safe evidence
  -> bounded continuation
```

Every tool, MCP server, subagent, review critic, goal evaluator, and interaction primitive should pass through that same lifecycle.

The project already has many of those pieces, but they are distributed, partially duplicated, and occasionally fail open. The best improvement is to consolidate the control plane, make isolation and evidence authoritative, and remove or downgrade features whose enforcement is currently only prompt-directed.
