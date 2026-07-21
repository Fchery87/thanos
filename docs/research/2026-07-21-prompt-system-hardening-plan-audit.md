# Prompt System Hardening Plan Audit

Date: 2026-07-21
Plan audited: `docs/plans/2026-07-20-prompt-system-hardening-plan.md`

## Findings

### 1. Phase 0 prompt baseline benchmarking is not implemented as specified

The plan requires a dedicated benchmark script, a prompt-budget performance test, prompt fixtures, and deterministic JSON artifact output for prompt-system baselines (`docs/plans/2026-07-20-prompt-system-hardening-plan.md:190-220`). The repo does not contain `scripts/benchmark-prompts.mjs` or `tests/performance/prompt-budget.test.ts`, and the checked-in benchmark artifact is unrelated to prompt-system budgets: it reports general architectural and policy timings instead of prompt sizes, evaluator input size, contract extraction accuracy, or subagent contract adherence (`benchmark-results.json:1-40`). CI uploads `.harness/benchmark-results.json`, but there is no corresponding benchmark implementation in the repo matching the plan's required measurements (`.github/workflows/ci.yml:104-119`).

Sources:
- Plan: `docs/plans/2026-07-20-prompt-system-hardening-plan.md:190-220`
- Workflow: `.github/workflows/ci.yml:104-119`
- Artifact: `benchmark-results.json:1-40`
- Missing files checked against plan targets: `scripts/benchmark-prompts.mjs`, `tests/performance/prompt-budget.test.ts`

### 2. Continuation authentication is weaker than the plan's required session-scoped nonce lifecycle

The plan requires an opaque continuation ID with `{ id, kind, specId?, goalId?, expiresAt, consumed }`, single-use exact matching, replay/expiry/cross-session/kind-mismatch protection, and no `String.includes()` authorization (`docs/plans/2026-07-20-prompt-system-hardening-plan.md:346-405`). The current implementation stores only `{ kind, prompt, consumed }` keyed by `sessionId`; it has no opaque ID, no expiry, no spec/goal identity fields, and authorization is based on exact prompt string equality (`src/runtime/continuation-auth.ts:1-25`). This is stronger than substring matching, but it is still materially different from the plan's authenticated continuation state model.

Sources:
- Plan: `docs/plans/2026-07-20-prompt-system-hardening-plan.md:346-405`
- Implementation: `src/runtime/continuation-auth.ts:1-25`
- Arbiter coverage only checks precedence, not nonce issue/expiry/replay metadata shape: `tests/runtime/continuation-arbiter.integration.test.ts:1-23`

### 3. Specialist authority is not fully singular because manifest validation is still partial and some shipped prompt metadata falls outside catalog-backed validation

The plan requires one catalog to determine authority, manifest validation against that catalog, rejection of unsupported delegation depth, validation of `maxExecutionTimeMs`, and resolution of Scout/Designer contradictions so that agent text, catalog profile, policy overlay, and live tools all agree (`docs/plans/2026-07-20-prompt-system-hardening-plan.md:413-508`). The current manifest validator checks tool membership, whether `subagent` is allowed at all, supported context mode, and positive `maxExecutionTimeMs`, but it does not parse or validate `maxSubagentDepth`, does not validate other frontmatter fields like `systemPromptMode`, `inheritProjectContext`, `defaultContext`, `defaultReads`, or `defaultProgress`, and does not enforce the plan's stated unsupported delegation depth rule (`src/agents/manifest.ts:1-30`). That matters because shipped agent files still declare uncatalogued behavior in frontmatter, such as Scout's `systemPromptMode`, `inheritProjectContext`, `defaultProgress`, and supervisor coordination prose, and Worker's `defaultContext`, `defaultReads`, and `defaultProgress`, without catalog-based validation (`agent/agents/scout.md:1-55`, `agent/agents/worker.md:1-56`). Designer also still carries branch-heavy embedded reference content in the main prompt instead of moving branch-specific references behind progressive disclosure as Phase 8 specifies (`agent/agents/designer.md:37-160`; plan `docs/plans/2026-07-20-prompt-system-hardening-plan.md:892-899`).

Sources:
- Plan: `docs/plans/2026-07-20-prompt-system-hardening-plan.md:413-508`, `docs/plans/2026-07-20-prompt-system-hardening-plan.md:892-899`
- Catalog: `src/agents/catalog.ts:8-20`, `src/agents/catalog.ts:30-226`
- Manifest validation: `src/agents/manifest.ts:1-30`
- Shipped prompts: `agent/agents/scout.md:1-55`, `agent/agents/worker.md:1-56`, `agent/agents/designer.md:37-160`
- Current roster contract test scope: `tests/agents/roster-contract.test.ts:17-134`

### 4. Jury runtime wiring is incomplete relative to the required runtime-owned workflow

The plan requires Review Jury to dispatch three critics through `AgentOrchestrator.runBatch`, require all three terminal results or timeout/failure recording, always run Oracle after critic collection, pass Oracle stable finding IDs, and derive verdicts from severity and workflow health; missing critics or Oracle must block `APPROVE` unless degraded behavior is explicitly defined (`docs/plans/2026-07-20-prompt-system-hardening-plan.md:740-809`). The current `AgentOrchestrator` has no `run` or `runBatch` interface at all, only in-memory batch bookkeeping helpers (`src/agents/orchestrator.ts:6-144`). `src/review/jury-runtime.ts` contains only result-shaping and synthesis helpers; it does not dispatch critics, enforce Oracle-after-critics sequencing, or fail closed on missing critic/oracle execution (`src/review/jury-runtime.ts:1-155`). Oracle reconciliation is still based on fuzzy keyword overlap in summary text rather than stable finding IDs (`src/review/jury-runtime.ts:78-95`). The repo also lacks the plan's required `tests/review/jury-runtime.integration.test.ts`; only a prompt-content test exists for jury wording (`tests/review/jury.test.ts:1-17`).

Sources:
- Plan: `docs/plans/2026-07-20-prompt-system-hardening-plan.md:740-809`
- Orchestrator: `src/agents/orchestrator.ts:6-144`
- Jury runtime: `src/review/jury-runtime.ts:1-155`
- Prompt-only jury test: `tests/review/jury.test.ts:1-17`
- Missing required integration test target: `tests/review/jury-runtime.integration.test.ts`

### 5. WAVES prompt/runtime contract is still split, and the worker prompt does not use the shared result contract required by the plan

The plan requires WAVES prompts to describe one child task and one result contract, removing runtime-owned workflow guarantees from prose, and Gate 7 says prompt compliance must not be required for width, depth, critic roster, or result collection (`docs/plans/2026-07-20-prompt-system-hardening-plan.md:786-809`). It also requires every live subagent to share the versioned result contract from Phase 4 (`docs/plans/2026-07-20-prompt-system-hardening-plan.md:550-573`). The current WAVES worker prompt still teaches a custom handoff text format (`Status: success | partial | blocked`, `Slice:`, `Key findings:`, etc.) rather than the shared JSON result contract (`src/waves/prompt.ts:4-17`). That differs from the plan's requirement that prompts use the common contract and place large handoff material in artifacts. The existing WAVES runtime tests cover overlap rejection and stopping after failed write slices, but they do not prove the full runtime-owned orchestration contract described in the plan (`tests/waves/runtime.integration.test.ts:1-39`).

Sources:
- Plan: `docs/plans/2026-07-20-prompt-system-hardening-plan.md:550-573`, `docs/plans/2026-07-20-prompt-system-hardening-plan.md:786-809`
- WAVES worker prompt: `src/waves/prompt.ts:4-17`
- WAVES runtime: `src/waves/runtime.ts:41-176`
- WAVES integration coverage: `tests/waves/runtime.integration.test.ts:1-39`

### 6. Prompt evaluation assets exist, but the release-threshold and adversarial-evaluation program is only partially implemented

The plan requires a versioned prompt-eval dataset whose cases go red when fixes are removed, deterministic prompt tests on every PR, modeled evaluations on scheduled or release workflows, at least two model families when available, repeated stochastic cases with pass rates, release blocking on safety regressions, and tracking of token cost, latency, and delegation count (`docs/plans/2026-07-20-prompt-system-hardening-plan.md:913-979`). The current dataset exists but is minimal: one line per family with only `id`, `family`, and `input`, and the grader only checks that those fields are non-empty (`evals/prompts/cases.jsonl:1-10`, `evals/prompts/graders.ts:1-32`). That does not encode the plan's required deterministic schema validity, forbidden tool trajectory, required orchestration stages, criterion coverage, fail-closed outcome, budgets, or red-if-fix-removed behavior. The scheduled prompt-evals workflow runs `bun scripts/eval-prompts.mjs`, but that script only summarizes case presence and family coverage; it does not run repeated stochastic evaluations, compare model families, or report token cost/latency/delegation metrics (`.github/workflows/prompt-evals.yml:1-33`, `scripts/eval-prompts.mjs:1-31`). Release workflow gating also does not invoke prompt evaluations or enforce safety-regression thresholds before publishing (`.github/workflows/release.yml:12-76`).

Sources:
- Plan: `docs/plans/2026-07-20-prompt-system-hardening-plan.md:913-979`
- Dataset: `evals/prompts/cases.jsonl:1-10`
- Graders: `evals/prompts/graders.ts:1-32`
- Eval script: `scripts/eval-prompts.mjs:1-31`
- Prompt eval workflow: `.github/workflows/prompt-evals.yml:1-33`
- Release workflow: `.github/workflows/release.yml:12-76`
- Dataset test scope: `tests/prompts/dataset.test.ts:5-24`

### 7. The final release gate is not fully satisfied because required release checks are not all wired or evidenced

The final gate requires `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:security`, `bun run test:integration`, and `bun run test:prompts`, plus prompt-evaluation coverage for every audit finding, catalog/contract alignment for every live role, authenticated continuation hardening, dynamic typed/untrusted context, evaluator injection protection, task-contract dataset thresholds, Jury/WAVES integration proof, 50% always-loaded-instructions reduction, and documentation that distinguishes policy/instruction/request/preference/evidence (`docs/plans/2026-07-20-prompt-system-hardening-plan.md:1056-1075`). The repo shows several of those pieces individually, but the shipped release workflow only runs `typecheck`, `lint`, and `test`; it does not separately run `test:security`, `test:integration`, `test:prompts`, or prompt evaluations before publishing (`.github/workflows/release.yml:48-76`). Combined with Findings 1, 4, 5, and 6, the plan's explicit release gate is not yet fully enforced by automation.

Sources:
- Plan: `docs/plans/2026-07-20-prompt-system-hardening-plan.md:1056-1075`
- Release workflow: `.github/workflows/release.yml:48-76`
- Available scripts: `package.json:12-25`

## Bottom Line

The codebase satisfies substantial parts of the plan, especially around context envelopes, evaluator boundary parsing, task contracts, and always-loaded-instruction pruning. The remaining blocking gaps are concentrated in baseline benchmarking, continuation-auth completeness, runtime-owned Jury/WAVES enforcement, and the release-grade prompt evaluation program.
