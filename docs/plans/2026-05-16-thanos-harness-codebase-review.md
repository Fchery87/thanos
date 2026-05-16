# Thanos Harness Codebase Review — 2026-05-16

## Review scope

This review checks whether the Thanos Harness codebase is structurally correct, properly placed, configured consistently, and aligned with the current domain docs and ADRs.

Reviewed sources:

- `CONTEXT.md`
- `README.md`
- `docs/adr/0001-subagent-subprocess-spawn.md`
- `docs/adr/0002-verified-release-bootstrap-installs.md`
- `docs/adr/0003-extension-first-agent-distribution.md`
- `docs/plans/2026-05-14-architecture-deepening.md`
- `docs/plans/2026-05-14-governed-interaction-primitives.md`
- `src/` module layout and load-bearing implementation files
- `tests/` coverage layout
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `scripts/install.sh`, `scripts/install.ps1`, `scripts/npm-install.mjs`
- `package.json`, `tsconfig.json`, `eslint.config.mjs`, `mcp.example.json`

Verification run:

```text
bun run ci
```

Observed result:

- TypeScript typecheck passed.
- ESLint completed with 21 warnings and 0 errors, all currently `@typescript-eslint/no-explicit-any` warnings in tests.
- Vitest passed: 176 tests, 0 failures, 318 assertions across 34 files.

## Executive verdict

The repository is directionally structured well: the domain vocabulary is strong, ADRs are in the right place, tests mirror the module layout, release automation exists, and the code has already started moving from a monolithic extension file toward domain Modules such as `governance`, `policy`, `spec`, `agents`, `interaction`, `mcp`, `audit`, and `security`.

It is not yet structurally complete enough to claim the documented **Team-grade Governance Layer** contract. Several load-bearing seams are documented but not actually wired:

1. Subagent policy inheritance and capability ceilings are not enforced end-to-end.
2. Policy files are not schema-validated and malformed policy silently falls back to permissive personal defaults.
3. MCP management is advertised as a feature, but the default MCP clients are no-op stubs.
4. MCP configuration levels are internally inconsistent.
5. `src/index.ts` remains the main orchestration monolith and should be split after the governance seams are corrected.

My strongest recommendation: fix the governance correctness gaps before adding more Agent Distribution features. Subagents and policy are the amplification points; if those seams are wrong, every future tool inherits the wrong safety model.

## What is structured correctly

### 1. Domain documentation is better than average

`CONTEXT.md` clearly names the product boundary: Thanos is an **Agent Distribution** with a **Team-grade Governance Layer** as the differentiator. That matters because the codebase now has a vocabulary for deciding whether a feature belongs here.

Strong parts:

- **Capability**, **Interaction Capability**, **Governed Tool Call**, **Policy File**, **SpecEngine**, **Subagent**, **Audit Log**, and **Extension-first Hybrid Strategy** are all named.
- ADRs record the major irreversible choices:
  - subprocess subagents, not in-process loops;
  - verified release artifacts, not mutable branch-tip install;
  - extension-first agent distribution, not wholesale runtime fork.
- Current plans explicitly call out the remaining architecture-deepening work.

No new domain term needs to be added from this review. The existing terms are enough; the main problem is implementation fidelity.

### 2. Directory layout is mostly sane

The `src/` layout is aligned with domain seams rather than only technical event names:

```text
src/
  audit/
  agents/
  commands/
  governance/
  hooks/
  interaction/
  mcp/
  memory/
  models/
  permissions/
  policy/
  review/
  security/
  spec/
  web/
  index.ts
```

This is the right direction. The separate folders are not perfect yet, but they are not arbitrary. They map to real Harness concepts.

### 3. Tests mirror the modules

The test layout follows the source layout closely. That is good for locality:

```text
tests/
  agents/
  commands/
  governance/
  hooks/
  interaction/
  mcp/
  memory/
  models/
  permissions/
  review/
  scripts/
  security/
  spec/
  web/
```

This makes the intended test surface legible. The missing coverage is not organization; it is specific load-bearing behaviours that are not tested yet.

### 4. Release distribution matches ADR 0002 in the POSIX path

The POSIX installer and release workflow mostly line up with ADR 0002:

- GitHub Release tarball is produced by `.github/workflows/release.yml` after typecheck, lint, and tests.
- `SHA256SUMS` is generated with the release tarball.
- `scripts/install.sh` resolves latest release, downloads the tarball and checksum file, verifies SHA256, prints resolved version/checksum/install directory/Pi version, then installs.
- Installer tests cover missing checksum tooling, checksum mismatch, latest release install, pinned version install, and `--skip-clone`.

This is one of the better-shaped areas of the repository.

## Findings

### P0 — Subagent governance ceiling is documented but not enforced end-to-end

**Files:**

- `src/agents/task-tool.ts:109-135`
- `src/agents/execution.ts:55-68`
- `src/policy/loader.ts:13-20`
- `src/agents/loader.ts:15-21`

**Issue:**

`executeTask()` writes a narrowed policy file to a temp path and passes it through `HARNESS_POLICY_FILE`:

```ts
const policyFile = parentPolicy ? path.join(tmp, "harness.policy.json") : undefined;
...
env: buildSubagentEnv(params.type, parentPolicy, policyFile),
```

`buildSubagentEnv()` sets `HARNESS_POLICY_FILE`, but `loadPolicy()` ignores that env var and always reads `join(cwd, "harness.policy.json")`. In build worktrees this usually means no policy file. In non-build subagents it means the child sees the repo policy, not the narrowed policy generated for that subagent.

Separately, `loadAgent()` returns only `{ body }`. It does not parse `tools`, `model`, `maxTurns`, or `timeoutMs` from agent markdown frontmatter, even though `task-tool.ts` is written as if those fields exist and will drive `--tools`, `--model`, and timeout behaviour.

**Why it matters:**

This contradicts the documented subagent model: subagents should inherit parent policy as a ceiling, and specialist capability ceilings should be enforced by agent definitions. Today, those ceilings are mostly aspirational. That weakens the core governance promise precisely where delegation amplifies risk.

**Recommendation:**

Implement this before adding more subagent features:

1. Make `loadPolicy()` accept an explicit policy file path or respect `HARNESS_POLICY_FILE`.
2. Fail closed if a configured policy file is unreadable or invalid.
3. Parse agent markdown frontmatter into `{ body, tools, model, maxTurns, timeoutMs }`.
4. Add tests proving:
   - `HARNESS_POLICY_FILE` wins over `cwd/harness.policy.json`;
   - read-only agents receive deny rules for edit/exec;
   - agent `tools` frontmatter becomes the `--tools` CLI arg;
   - reviewer can spawn only explore; leaf subagents cannot spawn `task`.

### P0 — Invalid or malformed policy silently downgrades to personal defaults

**Files:**

- `src/policy/loader.ts:5-20`
- `src/policy/types.ts:1-20`
- `docs/plans/2026-05-11-phase-1-policy-core-implementation.md:97-185`
- `CONTEXT.md:28-34`, `CONTEXT.md:146-170`

**Issue:**

`loadPolicy()` catches every read/parse error and returns:

```ts
{
  version: 1,
  preset: "personal",
  rules: [],
  audit: { enabled: false },
  headless: { defaultDecision: "ask" },
}
```

There is no runtime schema validation. There are also no built-in preset rules in the current implementation, despite the domain docs and phase plan describing **Policy Schema**, built-in sensitive-read defaults, team/CI fail-closed behaviour, and stable rule IDs.

**Why it matters:**

A typo in `harness.policy.json` can silently turn a team policy into a personal permissive policy. That is the wrong failure mode for a governance layer. The user thinks policy is active; the runtime silently applies weaker defaults.

**Recommendation:**

Add a `policy/schema.ts` and `policy/presets.ts` cutover:

1. `parsePolicy(value: unknown): HarnessPolicy` validates version, preset, rule IDs, capability, decision, reason, audit shape, headless shape.
2. `loadPolicy()` distinguishes missing file from invalid file:
   - missing file may use explicit default preset;
   - invalid configured file should fail closed and surface a policy denial/config error.
3. Built-in sensitive-read rules should be part of team/CI presets, not only examples in README.
4. Add tests for malformed JSON, missing rule IDs, invalid decisions, sensitive-read denial from presets, and headless team/CI failure.

### P1 — MCP management is advertised, but default MCP clients are no-op stubs

**Files:**

- `src/mcp/client.ts:11-39`
- `src/mcp/manager.ts:202-216`
- `README.md:120-176`

**Issue:**

`StdioMCPClient` and `HttpMCPClient` do not connect to anything:

- `connect()` is empty.
- `initialize()` is empty.
- `listTools()` returns `[]`.
- `callTool()` returns `"not connected"` with `isError: true`.

The manager lifecycle can show statuses, enable/disable servers, and register tools returned by a client, but the default clients never return tools. The README presents MCP management and a server catalog as shipped functionality.

**Why it matters:**

This creates a false affordance. Users will configure MCP servers, see `/mcp` commands, and expect tool registration, but the runtime cannot actually speak MCP. In a governance harness, visible-but-stubbed integrations are dangerous because they look controlled and operational when they are neither.

**Recommendation:**

Choose one clean cutover:

- **Preferred:** implement real MCP adapters now:
  - stdio JSON-RPC lifecycle: spawn process, initialize, list tools, call tool, shutdown;
  - HTTP/SSE adapter or explicitly rename `sse` to the protocol actually supported;
  - timeout and process cleanup;
  - redacted credential handling;
  - tests with fake stdio server and fake HTTP endpoint.
- **If not implementing now:** hide MCP from README and default UI, or mark it as experimental/nonfunctional until real adapters exist.

Do not leave no-op clients behind a production-looking `/mcp` surface.

### P1 — MCP configuration levels are inconsistent

**Files:**

- `src/mcp/config.ts:13-58`
- `src/mcp/manager.ts:63-102`
- `mcp.example.json:3-31`

**Issue:**

The type model has `global | user | project`, and `/mcp paths` displays all three. But `mcpConfigPaths()` returns the same path for `global` and `user`:

```ts
global: join(home, ".pi", "mcp.json"),
user: join(home, ".pi", "mcp.json"),
project: join(cwd, "mcp.json"),
```

`loadMcpConfigs()` reads only `global` and `project`; `user` is never loaded as a distinct config layer.

Also, `mcp.example.json` uses `"env": []` for stdio servers, while the TypeScript config type expects `env?: Record<string, string>`. The manager defensively ignores arrays, but the example is still shape-inconsistent.

**Why it matters:**

Configuration precedence is part of the user contract. Today the code and docs imply a three-level merge, but the implementation has a two-level merge with a duplicated label. That makes troubleshooting hard and weakens the extension-first distribution story.

**Recommendation:**

Either:

1. Make MCP config a real three-level system with distinct paths and explicit precedence; or
2. Delete the `user` level from the type/UI/docs and keep only global/project.

Also change example `env` fields to objects:

```json
"env": {}
```

Add tests for config precedence, removed server reload behaviour, invalid example shape, and source labeling.

### P1 — MCP reload does not clear removed servers

**Files:**

- `src/mcp/manager.ts:42-102`
- `src/mcp/manager.ts:194-198`

**Issue:**

`MCPManager.initialize()` adds current configs/statuses into maps but does not clear `clients`, `statuses`, `sources`, or `configs` before loading the new config. `disconnect()` only disconnects clients; it does not clear statuses/configs/sources.

So after `/mcp reload`, a server removed from config can remain in `getKnownNames()` and `getStatuses()`.

**Why it matters:**

Reload should reflect current config. Stale servers create confusing UI state and can preserve operations against servers that the user thought were removed.

**Recommendation:**

Make initialization replace the manager snapshot atomically:

1. Disconnect existing clients.
2. Clear maps.
3. Load merged config.
4. Build new status/config/source maps from that snapshot.

Add a test that initializes with `{ alpha }`, reloads with `{ beta }`, and asserts `alpha` is gone.

### P2 — `src/index.ts` is still too shallow as the main extension Module

**Files:**

- `src/index.ts:77-1197`
- `docs/plans/2026-05-14-architecture-deepening.md:11-35`

**Issue:**

The repository has extracted good Modules, but `src/index.ts` still owns too many unrelated behaviours:

- welcome header rendering;
- MCP command UI;
- thinking selector;
- slash command registration;
- keyboard shortcuts;
- memory injection;
- model routing;
- spec lifecycle;
- permission gate;
- secret scanning;
- git snapshotting;
- tool registrations for ask/todo/report_finding/task.

The architecture plan already names the correct direction: split by domain concepts, not by event names.

**Why it matters:**

`index.ts` is currently a high-churn file and the hardest place to reason about side effects. Bugs in policy, MCP, spec, memory, or UI all require touching the same file. That lowers locality.

**Recommendation:**

Do not split this first. Split it after P0 governance fixes so the seams are real.

Suggested modules:

- `src/extension/register.ts` — top-level composition only.
- `src/extension/session.ts` — session_start/session_shutdown.
- `src/extension/turn.ts` — before_agent_start/agent_end lifecycle.
- `src/extension/tools.ts` — ask/todo/report_finding/task/search registration.
- `src/extension/shortcuts.ts` — keyboard shortcuts.
- `src/mcp/commands.ts` — MCP command UI currently embedded in `index.ts`.
- `src/thinking/controls.ts` — thinking selector/status.

Keep `index.ts` as the Pi entry point only.

### P2 — Task batch contract exists but is not registered or executed

**Files:**

- `src/agents/task-tool.ts:41-50`
- `src/agents/task-tool.ts:82-88`
- `src/index.ts:1169-1195`
- `CONTEXT.md:166-167`

**Issue:**

`TaskBatchParamsSchema` and `validateTaskBatch()` exist and have tests, but no `task_batch` tool is registered and no batch execution path exists. The docs say task evolution includes typed parallel batches and structured outputs, but the implementation currently exposes only the single `task` tool.

**Why it matters:**

This is not a correctness bug by itself, but it is a misleading half-interface. Half-built contracts invite callers to depend on internals before the user-facing contract exists.

**Recommendation:**

Either remove/export-hide the batch schema until the tool is real, or complete the cutover with:

- registered `task_batch` tool;
- structured result array;
- concurrency limits;
- policy ceiling per item;
- transcript/artifact references;
- tests for duplicate IDs, partial failure, and reviewer-only delegation rules.

### P2 — Release path is good, but Windows installer parity is under-tested

**Files:**

- `scripts/install.sh`
- `scripts/install.ps1`
- `tests/scripts/install.test.ts`
- `.github/workflows/release.yml`

**Issue:**

The POSIX installer is covered with fixture-driven tests. The PowerShell installer implements similar release verification logic, but there are no equivalent fixture tests for it.

**Why it matters:**

ADR 0002 treats installer verification as a security boundary. If Windows is a supported install path, checksum and pinning failures need the same test signal as POSIX.

**Recommendation:**

Add Windows-focused tests in CI or a small PowerShell fixture test harness for:

- pinned install;
- latest install;
- checksum mismatch;
- missing checksum entry;
- `-SkipClone` behaviour;
- wrapper `thanos update` path.

## Strong implementation recommendations

### 1. Governance-first fix order

Do this before MCP, memory, browser tools, debug tools, or broader runtime features:

1. Implement policy parsing and preset loading.
2. Make invalid policy fail closed.
3. Make `HARNESS_POLICY_FILE` real.
4. Parse agent frontmatter.
5. Prove subagent policy ceilings with tests.

This is the trust boundary. Everything else builds on it.

### 2. Decide whether MCP is shipped or experimental

MCP is currently too visible for a stub. Either implement real clients or remove/hide the advertised surface until implementation exists.

Recommended default: implement real stdio MCP first, because most listed examples are stdio. Defer SSE/HTTP if needed, but make the type names honest.

### 3. Convert existing plans into smaller vertical slices

The current plans are useful but large. The next implementation should be cut into independently verifiable slices:

- Policy schema and presets.
- Subagent policy-file loading.
- Agent frontmatter parsing.
- MCP stdio client.
- MCP config precedence/reload correctness.
- `index.ts` split.

Each slice should have failing tests first, then implementation, then targeted verification.

### 4. Keep the current documentation strategy

The docs are a strength. Do not switch to generic architecture docs. Keep using:

- glossary terms in `CONTEXT.md`;
- ADRs only for irreversible/surprising trade-offs;
- policy-first README examples;
- implementation plans with explicit acceptance commands.

### 5. Raise TypeScript strictness after P0 fixes

`tsconfig.json` currently has `strict: false`. Do not flip it before the governance fixes; that would create broad noise. After P0/P1 seams are corrected, enable stricter checks incrementally:

1. `noImplicitAny`;
2. `strictNullChecks`;
3. `noUncheckedIndexedAccess` for policy/config-heavy modules.

Start with `src/policy`, `src/agents`, and `src/mcp` because those are configuration and trust-boundary heavy.

## Recommended next slice

**Slice:** Make policy and subagent ceilings real.

**Files likely involved:**

- `src/policy/types.ts`
- `src/policy/loader.ts`
- new `src/policy/schema.ts`
- new `src/policy/presets.ts`
- `src/agents/loader.ts`
- `src/agents/execution.ts`
- `src/agents/policy.ts`
- tests under `tests/policy/` and `tests/agents/`

**Acceptance criteria:**

- Malformed `harness.policy.json` fails closed instead of using personal defaults.
- Missing policy file uses an explicit selected default, not an accidental fallback.
- `HARNESS_POLICY_FILE` is read by subagents.
- Agent frontmatter controls `tools`, `model`, `maxTurns`, and `timeoutMs`.
- Read-only agents cannot write or execute even when parent policy allows those capabilities.
- Reviewer subagents can delegate only to explore.
- `bun run ci` passes.

## Grill question to resolve before implementation

The key decision is policy-loader failure mode:

**Should a malformed project `harness.policy.json` block the whole session, or should it only block governed tool calls while allowing read-only questions?**

Recommended answer: block governed tool calls and show a visible policy configuration error, while allowing instant/read-only explanatory prompts that do not touch sensitive paths. This preserves usability without silently weakening governance.
