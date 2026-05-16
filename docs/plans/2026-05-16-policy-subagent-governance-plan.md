# Policy and Subagent Governance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make policy loading, agent frontmatter, and subagent ceilings real so governance cannot silently weaken.

**Architecture:** Introduce a small policy-loading seam that can read an explicit policy file path and validate the policy shape before use. Parse agent markdown frontmatter into a structured definition so tool allowlists, model overrides, and timeouts actually affect subagent execution. Keep the current subprocess subagent model from ADR-0001; this work only deepens the seams around it.

**Tech Stack:** TypeScript, Bun, Vitest, TypeBox, Node built-ins.

### Task 1: Validate and load policy explicitly

**Files:**
- Modify: `src/policy/types.ts`
- Modify: `src/policy/loader.ts`
- Create: `src/policy/schema.ts`
- Create: `src/policy/presets.ts`
- Test: `tests/policy/loader.test.ts`
- Test: `tests/policy/schema.test.ts`

**Step 1: Write the failing tests**
- malformed policy JSON should fail closed instead of falling back silently
- missing policy file should still return the selected default preset
- explicit policy file path should be honored
- team/ci presets should include built-in sensitive-read deny rules

**Step 2: Run the tests and verify they fail**
Run:
```bash
bun test tests/policy/loader.test.ts tests/policy/schema.test.ts
```
Expected: fail because explicit parsing/preset behavior does not exist yet.

**Step 3: Implement the minimal policy parser and loader**
- add `parsePolicy(value)` with version/preset/rule validation
- add `getPresetPolicy(preset)` with built-in deny rules
- update `loadPolicy(cwd, policyPath?)` to prefer `HARNESS_POLICY_FILE` or an explicit path
- keep missing-file defaults separate from invalid-file failures

**Step 4: Re-run the tests**
Run:
```bash
bun test tests/policy/loader.test.ts tests/policy/schema.test.ts
```
Expected: pass.

### Task 2: Parse agent frontmatter into real subagent constraints

**Files:**
- Modify: `src/agents/loader.ts`
- Modify: `src/agents/execution.ts`
- Test: `tests/agents/loader.test.ts`
- Test: `tests/agents/execution.test.ts`

**Step 1: Write the failing tests**
- agent markdown frontmatter should populate `tools`, `model`, `maxTurns`, and `timeoutMs`
- `HARNESS_POLICY_FILE` should be passed through to child processes
- reviewer subagents should be able to spawn explore agents, but leaf subagents should not spawn task recursively

**Step 2: Run the tests and verify they fail**
Run:
```bash
bun test tests/agents/loader.test.ts tests/agents/execution.test.ts
```
Expected: fail because frontmatter parsing and explicit policy loading are incomplete.

**Step 3: Implement the minimal loader/execution changes**
- parse markdown frontmatter in `loadAgent`
- ensure `loadPolicy` can read the explicit policy file path from subagent env
- preserve the current subprocess model and worktree isolation for build agents
- keep reviewer `HARNESS_SUBAGENT=reviewer` behavior intact

**Step 4: Re-run the tests**
Run:
```bash
bun test tests/agents/loader.test.ts tests/agents/execution.test.ts
```
Expected: pass.

### Task 3: Prove the governance ceiling in the extension entrypoint

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/agents/task-tool.test.ts` if needed

**Step 1: Write the failing test**
- a subagent should receive the narrowed policy path and not the parent repo policy by accident
- a malformed policy should produce a visible error path rather than silent permissive fallback

**Step 2: Run the tests and verify they fail**
Run:
```bash
bun test tests/index.test.ts tests/agents/task-tool.test.ts
```
Expected: fail until the entrypoint and loader are wired together.

**Step 3: Implement the minimal entrypoint wiring**
- pass the resolved policy into task execution consistently
- keep the permission gate and audit hooks unchanged except for the new policy seam

**Step 4: Re-run the tests**
Run:
```bash
bun test tests/index.test.ts tests/agents/task-tool.test.ts
```
Expected: pass.

### Task 4: Full verification

**Files:**
- All touched files

**Step 1: Run project verification**
Run:
```bash
bun run ci
```
Expected: typecheck passes, lint has no new errors, tests pass.

**Step 2: Commit**
```bash
git add src tests docs/plans/2026-05-16-policy-subagent-governance-plan.md
git commit -m "feat: harden policy and subagent governance"
```