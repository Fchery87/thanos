# Architecture Deepening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deepen the Thanos architecture around load-bearing domain Modules so governance, specs, MCP, Subagents, and Web Search have better Locality, Leverage, testability, and AI-navigability.

**Architecture:** Introduce a **Governed Tool Call** Module first, then use that deeper Seam to simplify permission hooks, Audit Log target shaping, SpecEngine evidence capture, and command/shortcut rendering. Keep ADR-0001 intact: Subagents continue using subprocess spawn. Keep ADR-0002 intact: installer distribution remains verified-release based.

**Tech Stack:** TypeScript, Bun, Vitest, ESLint, Pi Extension API, TypeBox.

## Approved design decisions

1. **Governed Tool Call** is the core domain term and has been added to `CONTEXT.md`.
2. The Governed Tool Call Module owns normalization plus Policy File evaluation result shaping; final UI prompting stays outside.
3. `PermissionManager` survives, narrowed to session-scoped temporary decisions.
4. Glob matching becomes shared behaviour, not duplicated in policy and permissions.
5. Audit Log target creation moves behind the Governed Tool Call Interface.
6. SpecEngine classification stays inside SpecEngine until there is a second real Adapter.
7. SpecEngine generation becomes part of the lifecycle Interface.
8. SpecEngine returns structured results; UI rendering stays outside.
9. Evidence verification is consolidated before semantic matching is deepened.
10. `src/index.ts` is split by domain concepts, not by technical event names.
11. Slash commands and shortcuts share command-independent Modules.
12. MCP lifecycle moves out of `index.ts`; credential collection UI remains outside.
13. MCP OAuth is not split into protocol/runtime Adapters until tests force it.
14. Subagent execution is redesigned only inside ADR-0001's subprocess-spawn decision.
15. Build Subagents keep worktree isolation; other Specialists do not gain worktrees by default.
16. `HARNESS_SUBAGENT` remains an environment variable detail hidden behind Subagent execution.
17. Web Search provider order remains hardcoded initially, but centralized in a provider registry Module.
18. Web Search provider tests must be fixed before Web Search refactoring.
19. Web Search provider registry exposes injectable Adapters for tests.
20. Work happens in staged clean cutovers per Module.
21. No ADR is required before implementation.
22. Add more `CONTEXT.md` terms only when they become load-bearing.

## Task 1: Restore Web Search provider test signal

**Files:**
- Modify: `tests/web/search/providers/brave.test.ts`
- Modify: `tests/web/search/providers/exa.test.ts`
- Modify: `tests/web/search/providers/gemini.test.ts`
- Modify: `tests/web/search/providers/perplexity.test.ts`
- Modify: `tests/web/search/providers/tavily.test.ts`

**Step 1: Replace unavailable global stubbing helpers**

Use direct assignment with restore logic instead of `vi.stubGlobal` and `vi.unstubAllGlobals`:

```ts
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(response: unknown): void {
  globalThis.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}
```

Preserve existing environment variable cleanup in each provider test.

**Step 2: Run provider tests**

Run:

```bash
bun test tests/web/search/providers
```

Expected: provider tests pass.

**Step 3: Run Web Search tests**

Run:

```bash
bun test tests/web/search
```

Expected: Web Search tests pass.

**Step 4: Run full CI**

Run:

```bash
bun run ci
```

Expected: typecheck passes, lint has no errors, tests pass. Existing lint warnings may remain unless touched files introduce new warnings.

## Task 2: Introduce Governed Tool Call Module

**Files:**
- Create: `src/governance/tool-call.ts`
- Create: `tests/governance/tool-call.test.ts`
- Modify: `src/hooks/before-tool.ts`
- Modify: `src/commands/slash.ts`
- Modify: `src/hooks/after-tool.ts`
- Modify: `src/audit/target.ts`
- Modify: `src/permissions/risk.ts`
- Modify: `src/permissions/rules.ts`
- Modify: `src/policy/evaluator.ts`

**Step 1: Write failing tests for normalized tool facts**

Create `tests/governance/tool-call.test.ts` with tests for:

- `read` and `grep` normalize to **Capability** `read` and low **Risk Tier**.
- `write` and `edit` normalize to **Capability** `edit`.
- `bash` target comes from `input.command`.
- path-based tools target `input.path` or `input.file_path`.
- bash Audit Log target includes command family for `rm`, `git`, `npm`, `bun`, `curl`, `wget`, `ssh`, `chmod`, `chown`.
- unknown tools default to **Capability** `exec`.

Example shape:

```ts
import { describe, expect, it } from "vitest";
import { describeGovernedToolCall } from "../../src/governance/tool-call";

describe("describeGovernedToolCall", () => {
  it("normalizes read-like tools", () => {
    const call = describeGovernedToolCall("read", { path: "src/index.ts" });
    expect(call.capability).toBe("read");
    expect(call.target).toBe("src/index.ts");
    expect(call.auditTarget).toMatchObject({ kind: "literal", value: "src/index.ts" });
  });
});
```

**Step 2: Run the new test and verify failure**

Run:

```bash
bun test tests/governance/tool-call.test.ts
```

Expected: FAIL because `src/governance/tool-call.ts` does not exist.

**Step 3: Implement the Governed Tool Call Module**

Create `src/governance/tool-call.ts` exporting:

```ts
import { commandAuditTarget } from "../audit/target";
import { classifyRisk } from "../permissions/risk";
import type { Capability } from "../permissions/rules";
import type { AuditTarget } from "../audit/types";

export interface GovernedToolCall {
  toolName: string;
  input: Record<string, unknown>;
  capability: Capability;
  target: string;
  riskTier: ReturnType<typeof classifyRisk>;
  auditTarget: AuditTarget;
}

const TOOL_CAPABILITY: Record<string, Capability> = {
  read: "read",
  ls: "read",
  find: "read",
  grep: "read",
  write: "edit",
  edit: "edit",
  bash: "exec",
  task: "task",
};

export function capabilityForTool(toolName: string): Capability {
  return TOOL_CAPABILITY[toolName] ?? "exec";
}

export function targetForTool(toolName: string, input: Record<string, unknown>): string {
  const filePath = input.file_path ?? input.path;
  if (typeof filePath === "string" && filePath.length > 0) return filePath;
  if (input.command != null) return String(input.command);
  return toolName;
}

export function auditTargetForTool(toolName: string, target: string): AuditTarget {
  return toolName === "bash" ? commandAuditTarget(target) : { kind: "literal", value: target };
}

export function describeGovernedToolCall(
  toolName: string,
  input: Record<string, unknown>,
): GovernedToolCall {
  const target = targetForTool(toolName, input);
  return {
    toolName,
    input,
    capability: capabilityForTool(toolName),
    target,
    riskTier: classifyRisk(toolName, input),
    auditTarget: auditTargetForTool(toolName, target),
  };
}
```

**Step 4: Run the new test and verify pass**

Run:

```bash
bun test tests/governance/tool-call.test.ts
```

Expected: PASS.

**Step 5: Replace duplicated capability and target logic**

Update:

- `src/hooks/before-tool.ts` to call `describeGovernedToolCall`.
- `src/commands/slash.ts` to call `capabilityForTool` for `/tools`.
- `src/hooks/after-tool.ts` to use shared command family behaviour where relevant.

Remove duplicated `TOOL_CAPABILITY` and target extraction functions.

**Step 6: Run affected tests**

Run:

```bash
bun test tests/governance/tool-call.test.ts tests/index.test.ts tests/hooks/after-tool.test.ts
```

Expected: PASS.

## Task 3: Consolidate rule matching semantics

**Files:**
- Create: `src/governance/rule-match.ts`
- Create: `tests/governance/rule-match.test.ts`
- Modify: `src/permissions/rules.ts`
- Modify: `src/policy/evaluator.ts`
- Modify: `tests/index.test.ts`

**Step 1: Write failing matcher tests**

Create tests that assert:

- `*.env` matches `.env`-style paths if current behaviour requires it.
- `src/*.ts` matches `src/index.ts` but not `src/nested/index.ts` unless current behaviour intentionally allows it.
- exact substring fallback is either explicit or removed consistently.
- last-rule-wins remains true for session `PermissionRule[]`.
- Policy File evaluation returns the matched Rule ID.

**Step 2: Implement shared matcher**

Create `src/governance/rule-match.ts`:

```ts
export function matchGlob(pattern: string, value: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(value);
}
```

If substring matching must remain for backwards compatibility, encode it as a named exported function instead of hiding it in one evaluator.

**Step 3: Update evaluators**

Use the shared matcher in:

- `src/permissions/rules.ts`
- `src/policy/evaluator.ts`

Preserve their distinct decision ordering unless intentionally changed:

- `PermissionManager` session rules: last-rule-wins.
- Policy File rules: first matching policy rule currently wins. If changing this, add tests and document it in `CONTEXT.md`.

**Step 4: Run affected tests**

Run:

```bash
bun test tests/governance/rule-match.test.ts tests/index.test.ts
```

Expected: PASS.

## Task 4: Deepen Policy File evaluation into Governed Tool Call

**Files:**
- Modify: `src/governance/tool-call.ts`
- Modify: `src/hooks/before-tool.ts`
- Modify: `src/policy/evaluator.ts`
- Modify: `src/policy/denial.ts`
- Modify: `tests/governance/tool-call.test.ts`
- Modify: `tests/index.test.ts`

**Step 1: Write failing tests for Policy File result shaping**

Add tests asserting:

- a deny Policy File rule returns decision metadata with Rule ID and pattern.
- an ask Policy File rule returns ask metadata without final prompting.
- Audit Log target uses the Policy File pattern when the denial is pattern-based.

**Step 2: Add Policy File evaluation to Governed Tool Call Module**

Add an exported function such as:

```ts
export interface GovernedToolDecision {
  call: GovernedToolCall;
  policyDecision: PolicyDecision | null;
  auditTarget: AuditTarget;
}

export function evaluateGovernedToolCall(
  toolName: string,
  input: Record<string, unknown>,
  policy?: HarnessPolicy,
): GovernedToolDecision;
```

Do not perform UI confirmation here.

**Step 3: Update `before-tool.ts`**

Replace local policy evaluation and audit target construction with `evaluateGovernedToolCall`.

**Step 4: Run affected tests**

Run:

```bash
bun test tests/governance/tool-call.test.ts tests/index.test.ts
```

Expected: PASS.

## Task 5: Deepen SpecEngine lifecycle Interface

**Files:**
- Modify: `src/spec/engine.ts`
- Modify: `src/index.ts`
- Modify: `src/commands/slash.ts`
- Modify: `tests/index.test.ts`
- Create or modify: `tests/spec/engine.test.ts`

**Step 1: Write lifecycle tests**

Create `tests/spec/engine.test.ts` with tests for:

- instant prompts do not create active specs.
- ambient prompts create active specs without pending approval.
- explicit flag creates active specs with pending approval.
- starting a new prompt resets prior evidence.
- final assistant messages become manual evidence only when a spec exists.

**Step 2: Add lifecycle methods**

Add methods to `SpecEngine` such as:

```ts
startTurn(prompt: string, explicitFlag: boolean): FormalSpec | undefined;
recordToolResult(event: ToolResultEventLike): void;
finishTurn(messages: unknown): VerificationResult[];
```

Keep classification inside `SpecEngine`.

**Step 3: Move assistant-message extraction into SpecEngine or adjacent spec Module**

`src/index.ts` should not parse assistant messages for spec evidence directly.

**Step 4: Update hooks**

Update `src/index.ts` and `src/hooks/after-tool.ts` so lifecycle ordering is concentrated in SpecEngine.

**Step 5: Run affected tests**

Run:

```bash
bun test tests/spec/engine.test.ts tests/hooks/after-tool.test.ts tests/index.test.ts
```

Expected: PASS.

## Task 6: Consolidate Evidence verification

**Files:**
- Create: `src/spec/verification.ts`
- Create: `tests/spec/verification.test.ts`
- Modify: `src/spec/engine.ts`
- Modify: `src/spec/evidence.ts`
- Modify: `src/hooks/after-tool.ts`

**Step 1: Write verification tests**

Tests should assert:

- failed evidence never satisfies a criterion.
- all required evidence types must be present.
- extra evidence does not hurt.
- evidence summaries included in results are only from matching passed evidence.

**Step 2: Extract verification**

Move verification logic into `src/spec/verification.ts`:

```ts
export function verifyCriteria(
  spec: FormalSpec,
  evidence: EvidenceRecord[],
): VerificationResult[];
```

**Step 3: Use verification from SpecEngine**

`SpecEngine.verify()` delegates to `verifyCriteria`.

**Step 4: Run tests**

Run:

```bash
bun test tests/spec/verification.test.ts tests/spec/engine.test.ts tests/hooks/after-tool.test.ts
```

Expected: PASS.

## Task 7: Extract shared command and shortcut presenters

**Files:**
- Create: `src/commands/presenters.ts`
- Modify: `src/commands/slash.ts`
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

**Step 1: Identify duplicated presentations**

Move shared formatting for:

- policy panel
- spec panel
- audit rows
- session snapshot

Do not move command registration yet.

**Step 2: Write presenter tests**

Test presenters with `noopTheme` from `src/ui-utils.ts` or a minimal fake theme.

**Step 3: Update slash commands and shortcuts**

Both slash commands and shortcuts call the same presenter functions.

**Step 4: Run affected tests**

Run:

```bash
bun test tests/index.test.ts tests/index.modes.test.ts
```

Expected: PASS.

## Task 8: Deepen MCP lifecycle Module

**Files:**
- Create: `src/mcp/lifecycle.ts`
- Create: `tests/mcp/lifecycle.test.ts`
- Modify: `src/index.ts`
- Modify: `src/mcp/manager.ts`

**Step 1: Write MCP lifecycle tests**

Cover command-independent behavior:

- reload disconnects then initializes.
- enable reconnects a known server.
- disable marks a server disabled.
- connect and disconnect update status.
- unknown server returns a structured failure result.

Use fake `MCPManager` dependencies; do not hit network.

**Step 2: Implement lifecycle result types**

Create a discriminated result type:

```ts
export type McpLifecycleResult =
  | { kind: "ok"; message: string; connectedCount?: number }
  | { kind: "unknown-server"; name: string }
  | { kind: "failed"; message: string };
```

**Step 3: Move non-UI decision tree out of `index.ts`**

Keep UI selection/input in `index.ts`. Move action execution into `src/mcp/lifecycle.ts`.

**Step 4: Run tests**

Run:

```bash
bun test tests/mcp/lifecycle.test.ts tests/index.test.ts
```

Expected: PASS.

## Task 9: Deepen Subagent execution internals

**Files:**
- Create: `src/agents/execution.ts`
- Create: `tests/agents/execution.test.ts`
- Modify: `src/agents/task-tool.ts`
- Modify: `tests/agents/task-tool.test.ts`

**Step 1: Write tests for execution helpers**

Cover:

- Pi invocation selection.
- environment construction hides `HARNESS_SUBAGENT` details behind a typed function.
- JSON mode output parsing handles malformed lines.
- timeout result shape.
- abort handler cleanup.

**Step 2: Move execution internals**

Move pure helpers and subprocess lifecycle support into `src/agents/execution.ts`. Keep `executeTask` as the public task-tool entry point.

**Step 3: Preserve ADR-0001**

Do not introduce in-process agent execution. Subprocess spawn remains the only execution Adapter.

**Step 4: Run tests**

Run:

```bash
bun test tests/agents/execution.test.ts tests/agents/task-tool.test.ts tests/agents/worktree.test.ts
```

Expected: PASS.

## Task 10: Introduce Web Search provider registry Module

**Files:**
- Modify: `src/web/search/provider.ts`
- Modify: `src/web/search/types.ts`
- Modify: `src/web/search/index.ts`
- Create or modify: `tests/web/search/provider.test.ts`
- Modify: `tests/web/search/index.test.ts`

**Step 1: Write registry tests**

Cover:

- provider order comes from one registry.
- preference provider is tried first if available.
- unavailable providers are skipped.
- provider cache does not leak across tests when using injected registry.
- tool schema provider enum is derived from registry data or shares the same source.

**Step 2: Implement registry type**

Introduce a registry object that owns provider metadata, load functions, order, and cache:

```ts
export class SearchProviderRegistry {
  constructor(private readonly metas: ProviderMeta[]) {}
  getProvider(id: string): Promise<SearchProvider>;
  resolveChain(preference?: SearchProviderPreference): Promise<SearchProvider[]>;
  ids(): SearchProviderId[];
}
```

Keep default registry hardcoded for now.

**Step 3: Update executeSearch**

Allow dependency injection:

```ts
export async function executeSearch(
  params: SearchParams,
  preference?: SearchProviderPreference,
  registry = defaultSearchProviderRegistry,
): Promise<SearchResponse>
```

**Step 4: Run Web Search tests**

Run:

```bash
bun test tests/web/search
```

Expected: PASS.

## Task 11: Reduce `src/index.ts` to composition code

**Files:**
- Modify: `src/index.ts`
- Modify: `src/commands/slash.ts`
- Modify: `src/hooks/before-tool.ts`
- Modify: `src/hooks/after-tool.ts`
- Modify: files introduced in previous tasks
- Modify: `tests/index.test.ts`
- Modify: `tests/index.modes.test.ts`

**Step 1: Measure current responsibilities**

Before editing, note the remaining sections in `src/index.ts` that still contain product behavior rather than composition.

**Step 2: Move one domain slice at a time**

Move only behaviour already protected by tests from previous tasks. Avoid broad rewrites.

**Step 3: Keep Extension registration readable**

Final `register()` should read as assembly:

- create PermissionManager
- create SpecEngine
- load Policy File
- initialize MCP Manager
- register lifecycle handlers
- register commands
- register tools

**Step 4: Run full test suite**

Run:

```bash
bun run ci
```

Expected: typecheck passes, lint has no errors, all tests pass. Existing warnings should be resolved opportunistically only in touched files.
