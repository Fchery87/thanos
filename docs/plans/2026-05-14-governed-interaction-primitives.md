# Governed Interaction Primitives Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Thanos' first Oh-my-pi-inspired governed interaction primitives without weakening policy, audit, or subagent boundaries.

**Architecture:** Ship contract-first, extension-first slices. Add a real `interaction` capability before registering tools; then implement Ask and Todo as session-local governed primitives; then add structured reviewer findings only when findings cross the reviewer→parent boundary; then evolve Task Tool contracts before parallel execution.

**Tech Stack:** TypeScript, TypeBox schemas, Pi extension API, Vitest, existing Thanos policy/audit/spec modules.

## Review Gate

This plan intentionally revises the earlier version. Do not implement until the user approves this revised scope.

## Why This Revision Exists

The first plan had the right product direction but the wrong implementation pressure. It would have registered useful-looking tools before the governance/result plumbing was correct.

This revised plan fixes that by requiring:

- an explicit `interaction` capability instead of piggybacking on `task`;
- post-execution audit/evidence for ask decisions and reviewer findings;
- Ask v1 as single-question only;
- Todo tool before `/todo` command UX;
- `report_finding` only when findings reach the parent review flow structurally;
- task batching only after structured result contracts exist.

## Existing Context

- Product decisions: `CONTEXT.md`
- Architecture decision: `docs/adr/0003-extension-first-agent-distribution.md`
- Tool registration: `src/index.ts`
- Governance mapping: `src/governance/tool-call.ts`
- Policy capability types: `src/policy/types.ts`
- Session permission capability types: `src/permissions/rules.ts`
- Risk classification: `src/permissions/risk.ts`
- Pre-execution audit hook: `src/hooks/before-tool.ts`
- Post-execution spec hook: `src/hooks/after-tool.ts`
- Audit event shape/logger: `src/audit/types.ts`, `src/audit/logger.ts`
- Spec evidence extraction: `src/spec/evidence.ts`
- Subagent result parser: `src/agents/result.ts`
- Existing task tests: `tests/agents/task-tool.test.ts`

Project commands:

- Targeted test: `bun test tests/<path>.test.ts`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Full CI: `bun run ci`

## Non-Goals For This Tranche

- No runtime fork.
- No eval/LSP/DAP/browser implementation.
- No multi-question Ask forms in v1.
- No `/todo` command unless it falls out with no extra state plumbing.
- No arbitrary recursive subagents.
- No parallel batch execution until the result/artifact contract is stable.
- No silent project-file writes.

---

## Task 0: Align Domain Docs With Revised Scope

**Files:**
- Modify: `CONTEXT.md`
- Modify: `docs/adr/0003-extension-first-agent-distribution.md`

**Step 1: Update Ask v1 wording**

In `CONTEXT.md`, revise the Ask Tool entry from:

```md
Ask is single-question by default, with an explicit batched form mode only for tightly coupled decisions.
```

to:

```md
Ask v1 is single-question only. Batched form mode is a future extension and must not appear in the tool schema until both interactive and headless behavior are implemented end to end.
```

**Step 2: Add Interaction Capability glossary entry**

Add near the existing `Capability` entry:

```md
**Interaction Capability**
The `interaction` capability covers governed agent-human or reviewer-state interactions such as `ask`, `todo`, and `report_finding`. It is separate from `task` because these tools do not spawn subagents and should not inherit subagent delegation policy.
_Avoid_: Mapping interaction tools to `task` or `exec`
```

**Step 3: Update approved direction**

Add:

```md
- **Interaction capability**: Governed interaction primitives use a distinct `interaction` capability. `ask`, `todo`, and `report_finding` must be explicitly classified before registration.
- **Ask v1 scope**: Ship single-question Ask first; defer batched forms until the whole form contract is implemented.
```

**Step 4: Update ADR consequences**

In `docs/adr/0003-extension-first-agent-distribution.md`, add a consequence:

```md
- Governed interaction primitives introduce a separate `interaction` capability so policy does not confuse human/reviewer interaction with subagent delegation.
```

**Step 5: Verify documentation edits**

Run: `git diff -- CONTEXT.md docs/adr/0003-extension-first-agent-distribution.md`

Expected: Diff only reflects the revised scope and capability language.

**Step 6: Commit**

```bash
git add CONTEXT.md docs/adr/0003-extension-first-agent-distribution.md
git commit -m "docs: clarify governed interaction scope"
```

---

## Task 1: Add `interaction` Capability Before New Tools

**Files:**
- Modify: `src/policy/types.ts`
- Modify: `src/permissions/rules.ts`
- Modify: `src/governance/tool-call.ts`
- Modify: `src/permissions/risk.ts`
- Test: `tests/governance/tool-call.test.ts`
- Test: `tests/permissions/rules.test.ts` if existing, otherwise create it

**Step 1: Write failing governance tests**

Create or extend `tests/governance/tool-call.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { capabilityForTool, describeGovernedToolCall } from "../../src/governance/tool-call";

describe("governed interaction tools", () => {
  it("classifies ask as interaction", () => {
    expect(capabilityForTool("ask")).toBe("interaction");
  });

  it("classifies todo as interaction", () => {
    expect(capabilityForTool("todo")).toBe("interaction");
  });

  it("classifies report_finding as interaction", () => {
    expect(capabilityForTool("report_finding")).toBe("interaction");
  });

  it("keeps unknown tools conservative as exec", () => {
    expect(capabilityForTool("unknown_tool")).toBe("exec");
  });

  it("uses medium risk for interaction tools", () => {
    expect(describeGovernedToolCall("ask", { question: "Pick one" }).riskTier).toBe("medium");
  });
});
```

Create or extend `tests/permissions/rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../src/permissions/rules";

describe("interaction permission rules", () => {
  it("allows explicit interaction rules", () => {
    expect(evaluateRules([
      { capability: "interaction", pattern: "ask", decision: "allow", source: "session" },
    ], "interaction", "ask")).toBe("allow");
  });
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/governance/tool-call.test.ts tests/permissions/rules.test.ts
```

Expected: FAIL because `interaction` is not in the capability union and tools are not mapped.

**Step 3: Extend capability types**

In `src/policy/types.ts` and `src/permissions/rules.ts`, change:

```ts
export type Capability = "read" | "edit" | "exec" | "task";
```

to:

```ts
export type Capability = "read" | "edit" | "exec" | "task" | "interaction";
```

**Step 4: Map new tools explicitly**

In `src/governance/tool-call.ts`, update `TOOL_CAPABILITY`:

```ts
const TOOL_CAPABILITY: Record<string, Capability> = {
  read: "read",
  ls: "read",
  find: "read",
  grep: "read",
  write: "edit",
  edit: "edit",
  bash: "exec",
  task: "task",
  ask: "interaction",
  todo: "interaction",
  report_finding: "interaction",
};
```

**Step 5: Keep risk classifier conservative**

`src/permissions/risk.ts` already returns `medium` for unknown/non-low/non-high/non-critical tools. Add an explicit set only if it improves readability:

```ts
const MEDIUM_RISK = new Set(["task", "ask", "todo", "report_finding"]);
```

Then check before default:

```ts
if (MEDIUM_RISK.has(toolName)) return "medium";
```

**Step 6: Run targeted tests**

Run:

```bash
bun test tests/governance/tool-call.test.ts tests/permissions/rules.test.ts
```

Expected: PASS.

**Step 7: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

**Step 8: Commit**

```bash
git add src/policy/types.ts src/permissions/rules.ts src/governance/tool-call.ts src/permissions/risk.ts tests/governance/tool-call.test.ts tests/permissions/rules.test.ts
git commit -m "feat: add interaction capability"
```

---

## Task 2: Add Post-Execution Interaction Evidence/Audit Plumbing

**Files:**
- Modify: `src/audit/types.ts`
- Modify: `src/hooks/after-tool.ts`
- Modify: `src/spec/evidence.ts`
- Modify: `src/index.ts` only if hook construction needs audit logger access
- Test: `tests/hooks/after-tool.test.ts`
- Test: `tests/spec/evidence.test.ts` if existing, otherwise create it

**Step 1: Write failing evidence tests**

Create or extend `tests/spec/evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evidenceFromToolResult } from "../../src/spec/evidence";

describe("interaction evidence", () => {
  it("records ask results as manual evidence from ask", () => {
    const evidence = evidenceFromToolResult({
      toolName: "ask",
      content: [{ type: "text", text: JSON.stringify({ selected: ["extend"], source: "user" }) }],
    });

    expect(evidence).toMatchObject({ type: "manual", source: "ask", passed: true });
  });

  it("records report_finding results as manual evidence from report_finding", () => {
    const evidence = evidenceFromToolResult({
      toolName: "report_finding",
      content: [{ type: "text", text: "P1: Policy bypass" }],
    });

    expect(evidence).toMatchObject({ type: "manual", source: "report_finding", passed: true });
  });
});
```

Extend `tests/hooks/after-tool.test.ts` to verify post-execution audit if an `AuditLogger` is passed:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeAfterToolHandler } from "../../src/hooks/after-tool";

describe("after tool interaction audit", () => {
  it("records safe ask metadata after execution", async () => {
    const spec = { recordToolResult: vi.fn() };
    const auditLogger = { record: vi.fn(async () => undefined) };
    const handler = makeAfterToolHandler(spec as any, auditLogger as any, {
      sessionId: "s1",
      agentType: "parent",
    });

    await handler({
      toolName: "ask",
      content: [{ type: "text", text: JSON.stringify({ question: "Pick", selected: ["a"], recommended: "a", source: "user" }) }],
    });

    expect(auditLogger.record).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "ask",
      capability: "interaction",
      decision: "allow",
      metadata: expect.objectContaining({ selected: ["a"], recommended: "a", source: "user" }),
    }));
  });
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/spec/evidence.test.ts tests/hooks/after-tool.test.ts
```

Expected: FAIL because `makeAfterToolHandler` does not accept audit logger/context and evidence has no explicit interaction branches.

**Step 3: Extend audit event shape**

In `src/audit/types.ts`, add optional metadata:

```ts
metadata?: Record<string, unknown>;
```

This is only valid because this task also adds the write path.

**Step 4: Add safe metadata extraction**

In `src/spec/evidence.ts`, export a helper:

```ts
export function safeInteractionMetadata(event: ToolResultEventLike): Record<string, unknown> | undefined {
  const output = textFromContent(event.content) || event.output?.trim() || "";
  if (!output) return undefined;

  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (event.toolName === "ask") {
      return {
        ...(typeof parsed.question === "string" ? { question: parsed.question } : {}),
        ...(Array.isArray(parsed.options) ? { options: parsed.options } : {}),
        ...(Array.isArray(parsed.selected) ? { selected: parsed.selected } : {}),
        ...(typeof parsed.recommended === "string" ? { recommended: parsed.recommended } : {}),
        ...(typeof parsed.source === "string" ? { source: parsed.source } : {}),
        ...(typeof parsed.rationale === "string" ? { rationale: parsed.rationale } : {}),
      };
    }

    if (event.toolName === "report_finding") {
      return {
        ...(typeof parsed.priority === "string" ? { priority: parsed.priority } : {}),
        ...(typeof parsed.summary === "string" ? { summary: parsed.summary } : {}),
        ...(typeof parsed.verdict === "string" ? { verdict: parsed.verdict } : {}),
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}
```

If `textFromContent` is private, either keep helper internal and test through `after-tool`, or export it only if needed.

**Step 5: Extend after-tool hook**

Change `src/hooks/after-tool.ts` from:

```ts
export function makeAfterToolHandler(spec: SpecEngine) {
  return async (event: ToolResultEventLike): Promise<void> => {
    spec.recordToolResult(event);
  };
}
```

to a backward-compatible signature:

```ts
export function makeAfterToolHandler(
  spec: SpecEngine,
  auditLogger?: AuditLogger,
  auditContext?: { sessionId: string; agentType: "parent" | "subagent" },
) {
  return async (event: ToolResultEventLike): Promise<void> => {
    spec.recordToolResult(event);

    const metadata = safeInteractionMetadata(event);
    if (!metadata || !auditLogger || !auditContext) return;

    await auditLogger.record({
      timestamp: new Date().toISOString(),
      sessionId: auditContext.sessionId,
      agentType: auditContext.agentType,
      toolName: event.toolName,
      capability: "interaction",
      decision: event.isError ? "deny" : "allow",
      target: { kind: "literal", value: event.toolName },
      metadata,
    });
  };
}
```

Import `AuditLogger`, `safeInteractionMetadata` as needed.

**Step 6: Wire audit logger from index**

Where `makeAfterToolHandler(spec)` is called in `src/index.ts`, pass the audit logger and context if already available. If session ID is not available, use existing session identifier source if present. If no session ID exists in context, use a stable fallback already used by audit code; do not invent a random ID per event.

**Step 7: Run targeted tests**

Run:

```bash
bun test tests/spec/evidence.test.ts tests/hooks/after-tool.test.ts
```

Expected: PASS.

**Step 8: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

**Step 9: Commit**

```bash
git add src/audit/types.ts src/hooks/after-tool.ts src/spec/evidence.ts src/index.ts tests/spec/evidence.test.ts tests/hooks/after-tool.test.ts
git commit -m "feat: audit interaction results"
```

---

## Task 3: Ask Tool v1 Pure Schema And Decision Helpers

**Files:**
- Create: `src/interaction/ask.ts`
- Create: `tests/interaction/ask.test.ts`

**Step 1: Write failing tests**

Create `tests/interaction/ask.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import {
  AskParamsSchema,
  buildAskDecision,
  buildAskAuditMetadata,
  resolveHeadlessAsk,
} from "../../src/interaction/ask";

const baseQuestion = {
  question: "Which implementation strategy should Thanos use?",
  options: [
    { id: "extend", label: "Extension-first" },
    { id: "fork", label: "Fork runtime" },
  ],
  recommended: "extend",
};

describe("AskParamsSchema", () => {
  it("accepts a single option question with stable option ids", () => {
    expect(Value.Check(AskParamsSchema, baseQuestion)).toBe(true);
  });

  it("rejects missing recommendation", () => {
    expect(Value.Check(AskParamsSchema, { question: "Pick", options: baseQuestion.options })).toBe(false);
  });

  it("rejects batched forms in v1", () => {
    expect(Value.Check(AskParamsSchema, { questions: [baseQuestion] })).toBe(false);
  });

  it("rejects duplicate option ids in helper validation", () => {
    expect(() => buildAskDecision({
      ...baseQuestion,
      options: [{ id: "same", label: "A" }, { id: "same", label: "B" }],
    }, ["same"], "user")).toThrow(/duplicate option id/i);
  });
});

describe("buildAskDecision", () => {
  it("returns a structured decision record", () => {
    const decision = buildAskDecision(baseQuestion, ["extend"], "user", "Keeps maintenance bounded");

    expect(decision).toEqual({
      question: baseQuestion.question,
      options: ["extend", "fork"],
      selected: ["extend"],
      recommended: "extend",
      source: "user",
      rationale: "Keeps maintenance bounded",
    });
  });

  it("rejects unknown selections", () => {
    expect(() => buildAskDecision(baseQuestion, ["unknown"], "user")).toThrow(/unknown option/i);
  });

  it("requires exactly one selection", () => {
    expect(() => buildAskDecision(baseQuestion, ["extend", "fork"], "user")).toThrow(/exactly one/i);
  });
});

describe("resolveHeadlessAsk", () => {
  it("fails closed for team and ci presets", () => {
    expect(resolveHeadlessAsk(baseQuestion, "team")).toEqual({ kind: "blocked", reason: expect.stringContaining("interactive UI") });
    expect(resolveHeadlessAsk(baseQuestion, "ci")).toEqual({ kind: "blocked", reason: expect.stringContaining("interactive UI") });
  });

  it("uses recommended answer for personal preset when timeout is configured", () => {
    expect(resolveHeadlessAsk({ ...baseQuestion, timeoutSeconds: 1 }, "personal")).toEqual({
      kind: "selected",
      selected: ["extend"],
      source: "default",
    });
  });
});

describe("buildAskAuditMetadata", () => {
  it("includes only safe metadata", () => {
    const decision = buildAskDecision(baseQuestion, ["extend"], "user", "safe rationale");
    expect(buildAskAuditMetadata(decision)).toEqual({
      question: baseQuestion.question,
      options: ["extend", "fork"],
      selected: ["extend"],
      recommended: "extend",
      source: "user",
      rationale: "safe rationale",
    });
  });
});
```

**Step 2: Run test to verify failure**

Run: `bun test tests/interaction/ask.test.ts`

Expected: FAIL because `src/interaction/ask.ts` does not exist.

**Step 3: Implement pure module**

Create `src/interaction/ask.ts`:

```ts
import { Type } from "typebox";
import type { PolicyPreset } from "../policy/types";

export const AskOptionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
});

export const AskParamsSchema = Type.Object({
  question: Type.String({ minLength: 1 }),
  options: Type.Array(AskOptionSchema, { minItems: 2 }),
  recommended: Type.String({ minLength: 1 }),
  allowOther: Type.Optional(Type.Boolean()),
  rationale: Type.Optional(Type.Boolean()),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  evidenceScope: Type.Optional(Type.String()),
});

export type AskOption = { id: string; label: string; description?: string };
export type AskQuestion = {
  question: string;
  options: AskOption[];
  recommended: string;
  allowOther?: boolean;
  rationale?: boolean;
  timeoutSeconds?: number;
  evidenceScope?: string;
};
export type AskDecisionSource = "user" | "default";
export type AskDecision = {
  question: string;
  options: string[];
  selected: string[];
  recommended: string;
  source: AskDecisionSource;
  rationale?: string;
  evidenceScope?: string;
};

function optionIds(question: AskQuestion): string[] {
  return question.options.map((option) => option.id);
}

function assertUnique(ids: string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error("duplicate option id");
}

function assertKnown(ids: string[], selected: string[]): void {
  const known = new Set(ids);
  for (const id of selected) {
    if (!known.has(id)) throw new Error(`unknown option: ${id}`);
  }
}

export function buildAskDecision(
  question: AskQuestion,
  selected: string[],
  source: AskDecisionSource,
  rationale?: string,
): AskDecision {
  const ids = optionIds(question);
  assertUnique(ids);
  assertKnown(ids, selected);
  if (selected.length !== 1) throw new Error("ask requires exactly one selection");

  return {
    question: question.question,
    options: ids,
    selected,
    recommended: question.recommended,
    source,
    ...(rationale ? { rationale } : {}),
    ...(question.evidenceScope ? { evidenceScope: question.evidenceScope } : {}),
  };
}

export function buildAskAuditMetadata(decision: AskDecision): Record<string, unknown> {
  return {
    question: decision.question,
    options: decision.options,
    selected: decision.selected,
    recommended: decision.recommended,
    source: decision.source,
    ...(decision.rationale ? { rationale: decision.rationale } : {}),
  };
}

export function resolveHeadlessAsk(
  question: AskQuestion,
  preset: PolicyPreset,
): { kind: "blocked"; reason: string } | { kind: "selected"; selected: string[]; source: "default" } {
  if (preset !== "personal") return { kind: "blocked", reason: "ask requires interactive UI" };
  if (typeof question.timeoutSeconds !== "number" || question.timeoutSeconds <= 0) {
    return { kind: "blocked", reason: "ask requires interactive UI" };
  }
  return { kind: "selected", selected: [question.recommended], source: "default" };
}
```

**Step 4: Run targeted test**

Run: `bun test tests/interaction/ask.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/interaction/ask.ts tests/interaction/ask.test.ts
git commit -m "feat: add ask decision model"
```

---

## Task 4: Register Ask Tool v1

**Files:**
- Modify: `src/index.ts`
- Test: `tests/interaction/ask-tool.test.ts`

**Step 1: Write failing registration tests**

Create `tests/interaction/ask-tool.test.ts` using minimal Pi stubs copied from existing `tests/index.test.ts` style.

Required tests:

```ts
import { describe, expect, it, vi } from "vitest";
import register from "../../src/index";

function fakePi(tools: Map<string, any>) {
  return {
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    on: vi.fn(),
    getActiveTools: () => [],
    getAllTools: () => [],
    setting: (_name: string, opts: any) => opts.default,
  } as any;
}

describe("ask tool", () => {
  it("registers ask in main sessions", () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));
    expect(tools.has("ask")).toBe(true);
  });

  it("returns selected option from interactive UI", async () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));

    const result = await tools.get("ask").execute("ask-1", {
      question: "Pick one",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      recommended: "a",
    }, undefined, undefined, {
      hasUI: true,
      ui: { select: vi.fn(async () => "b") },
    });

    expect(JSON.parse(result.content[0].text)).toMatchObject({ selected: ["b"], source: "user" });
  });

  it("fails closed in team headless mode", async () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));

    const result = await tools.get("ask").execute("ask-1", {
      question: "Pick one",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      recommended: "a",
    }, undefined, undefined, { hasUI: false, ui: {} });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("interactive UI");
  });
});
```

**Step 2: Run test to verify failure**

Run: `bun test tests/interaction/ask-tool.test.ts`

Expected: FAIL because `ask` is not registered.

**Step 3: Register tool**

In `src/index.ts`:

- import `AskParamsSchema`, `buildAskDecision`, `resolveHeadlessAsk`;
- register `ask` only for main sessions;
- interactive path calls `_ctx.ui.select(params.question, params.options.map((o) => o.id))` or the closest supported UI shape in this repo;
- headless path calls `resolveHeadlessAsk(params, policy.preset)`;
- return decision record as JSON text;
- return `isError: true` for blocked headless asks.

**Step 4: Run targeted tests**

Run:

```bash
bun test tests/interaction/ask.test.ts tests/interaction/ask-tool.test.ts tests/governance/tool-call.test.ts
```

Expected: PASS.

**Step 5: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/index.ts tests/interaction/ask-tool.test.ts
git commit -m "feat: register ask tool"
```

---

## Task 5: Todo Tool Pure State Model

**Files:**
- Create: `src/interaction/todo.ts`
- Create: `tests/interaction/todo.test.ts`

**Step 1: Write failing tests**

Create `tests/interaction/todo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createTodoState,
  applyTodoOperation,
  exportTodoMarkdown,
  importTodoMarkdown,
} from "../../src/interaction/todo";

describe("todo state", () => {
  it("initializes phased tasks with exactly one in-progress task", () => {
    const state = createTodoState([{ phase: "Implementation", items: ["Add ask tool", "Add todo tool"] }]);
    expect(state.phases[0].items.map((item) => item.status)).toEqual(["in_progress", "pending"]);
  });

  it("marks next pending task in progress when current task completes", () => {
    let state = createTodoState([{ phase: "Implementation", items: ["Add ask tool", "Add todo tool"] }]);
    state = applyTodoOperation(state, { op: "done", task: "Add ask tool" });
    expect(state.phases[0].items.map((item) => item.status)).toEqual(["completed", "in_progress"]);
  });

  it("adds notes without changing task identity", () => {
    let state = createTodoState([{ phase: "Implementation", items: ["Add ask tool"] }]);
    state = applyTodoOperation(state, { op: "note", task: "Add ask tool", text: "UI path covered" });
    expect(state.phases[0].items[0]).toMatchObject({ content: "Add ask tool", notes: ["UI path covered"] });
  });

  it("round-trips explicit markdown export/import", () => {
    const state = createTodoState([{ phase: "Implementation", items: ["Add ask tool"] }]);
    const markdown = exportTodoMarkdown(state);
    expect(importTodoMarkdown(markdown)).toEqual(state);
  });
});
```

**Step 2: Run test to verify failure**

Run: `bun test tests/interaction/todo.test.ts`

Expected: FAIL because module does not exist.

**Step 3: Implement state model**

Create `src/interaction/todo.ts` with:

- `TodoStatus = "pending" | "in_progress" | "completed" | "abandoned"`
- `TodoItem = { content: string; status: TodoStatus; notes: string[] }`
- `TodoPhase = { name: string; items: TodoItem[] }`
- `TodoState = { phases: TodoPhase[] }`
- `createTodoState()`
- `applyTodoOperation()`
- `exportTodoMarkdown()`
- `importTodoMarkdown()`

Markdown format:

```md
# TODO

## Implementation
- [>] Add ask tool
- [ ] Add todo tool
- [x] Completed task
- [-] Abandoned task
  - note: UI path covered
```

**Step 4: Run targeted test**

Run: `bun test tests/interaction/todo.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/interaction/todo.ts tests/interaction/todo.test.ts
git commit -m "feat: add todo state model"
```

---

## Task 6: Register Todo Tool Without Slash Command

**Files:**
- Modify: `src/interaction/todo.ts`
- Modify: `src/index.ts`
- Create: `tests/interaction/todo-tool.test.ts`

**Step 1: Write failing tool tests**

Create `tests/interaction/todo-tool.test.ts` with tests that:

- `todo` is registered in main sessions.
- `todo init` returns first task in progress.
- `todo done` advances next task.
- `todo export` returns markdown text and does not write files.

**Step 2: Run test to verify failure**

Run: `bun test tests/interaction/todo-tool.test.ts`

Expected: FAIL because `todo` is not registered.

**Step 3: Add params schema**

In `src/interaction/todo.ts`, export `TodoParamsSchema` with operation union:

```ts
Type.Union([
  Type.Object({ op: Type.Literal("init"), list: Type.Array(Type.Object({ phase: Type.String(), items: Type.Array(Type.String()) })) }),
  Type.Object({ op: Type.Literal("done"), task: Type.String() }),
  Type.Object({ op: Type.Literal("drop"), task: Type.String() }),
  Type.Object({ op: Type.Literal("append"), phase: Type.String(), items: Type.Array(Type.String()) }),
  Type.Object({ op: Type.Literal("note"), task: Type.String(), text: Type.String() }),
  Type.Object({ op: Type.Literal("export") }),
  Type.Object({ op: Type.Literal("import"), markdown: Type.String() }),
])
```

**Step 4: Register todo tool**

In `src/index.ts`:

- create session-local `let todoState = createTodoState([])` inside `register()`;
- register `todo` only for main sessions;
- mutate `todoState` through `applyTodoOperation()`;
- return JSON state for state operations;
- return markdown for `export`;
- do not write `TODO.md` or any other file.

**Step 5: Run targeted tests**

Run:

```bash
bun test tests/interaction/todo.test.ts tests/interaction/todo-tool.test.ts tests/governance/tool-call.test.ts
```

Expected: PASS.

**Step 6: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

**Step 7: Commit**

```bash
git add src/interaction/todo.ts src/index.ts tests/interaction/todo-tool.test.ts
git commit -m "feat: register todo tool"
```

---

## Task 7: Report Finding Pure Model

**Files:**
- Create: `src/review/findings.ts`
- Create: `tests/review/findings.test.ts`

**Step 1: Write failing tests**

Create `tests/review/findings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { FindingParamsSchema, addFinding, verdictForFindings } from "../../src/review/findings";

describe("FindingParamsSchema", () => {
  it("accepts P0-P3 findings with evidence", () => {
    expect(Value.Check(FindingParamsSchema, {
      priority: "P1",
      summary: "Policy bypass",
      rationale: "The tool skips governance checks.",
      file: "src/index.ts",
      line: 123,
      suggestedFix: "Route through governed tool call evaluation.",
    })).toBe(true);
  });

  it("rejects invalid priority", () => {
    expect(Value.Check(FindingParamsSchema, {
      priority: "P4",
      summary: "Nit",
      rationale: "Invalid.",
    })).toBe(false);
  });
});

describe("review verdict", () => {
  it("requests changes for P0-P1 findings", () => {
    const findings = addFinding([], { priority: "P1", summary: "Bug", rationale: "Breaks policy." });
    expect(verdictForFindings(findings)).toBe("request-changes");
  });

  it("comments for P2-P3 findings", () => {
    const findings = addFinding([], { priority: "P3", summary: "Nit", rationale: "Minor." });
    expect(verdictForFindings(findings)).toBe("comment");
  });

  it("approves when no findings exist", () => {
    expect(verdictForFindings([])).toBe("approve");
  });
});
```

**Step 2: Run test to verify failure**

Run: `bun test tests/review/findings.test.ts`

Expected: FAIL because module does not exist.

**Step 3: Implement pure model**

Create `src/review/findings.ts` with:

- `FindingPriority = "P0" | "P1" | "P2" | "P3"`
- `ReviewVerdict = "approve" | "comment" | "request-changes"`
- `FindingParamsSchema`
- `addFinding()`
- `verdictForFindings()`
- `formatReviewSummary()`

Verdict rules:

- P0/P1 => `request-changes`
- P2/P3 only => `comment`
- none => `approve`

**Step 4: Run targeted test**

Run: `bun test tests/review/findings.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/review/findings.ts tests/review/findings.test.ts
git commit -m "feat: add review finding model"
```

---

## Task 8: Register Reviewer-Only `report_finding` And Parent Metadata Path

**Files:**
- Modify: `src/index.ts`
- Modify: `src/agents/result.ts` if parser needs stricter metadata validation
- Modify: reviewer agent prompt under `agent/agents/` if it exists
- Create: `tests/review/report-finding-tool.test.ts`
- Create: `tests/review/reviewer-result.test.ts`

**Step 1: Find reviewer prompt file**

Use `find` for `agent/agents/*review*` and `agent/agents/*`.

Expected: identify whether a reviewer prompt exists. If not, skip prompt edit.

**Step 2: Write failing tool tests**

Create `tests/review/report-finding-tool.test.ts` with tests that:

- `report_finding` registers only when `HARNESS_SUBAGENT=reviewer`.
- it does not register in main sessions.
- executing it stores a finding and returns current aggregate verdict.

**Step 3: Write failing parent metadata test**

Create `tests/review/reviewer-result.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSubagentResult } from "../../src/agents/result";

describe("reviewer structured metadata", () => {
  it("parses findings and verdict metadata from reviewer JSON output", () => {
    const parsed = parseSubagentResult(JSON.stringify({
      text: "Review complete.",
      metadata: {
        verdict: "request-changes",
        findings: [{ priority: "P1", summary: "Bug", rationale: "Breaks policy." }],
      },
    }));

    expect(parsed.metadata).toMatchObject({ verdict: "request-changes" });
    expect(parsed.metadata?.findings).toHaveLength(1);
  });
});
```

**Step 4: Run tests to verify failure**

Run:

```bash
bun test tests/review/report-finding-tool.test.ts tests/review/reviewer-result.test.ts
```

Expected: report_finding test fails because tool is not registered. Parser test may already pass; if so, keep it as regression coverage.

**Step 5: Register reviewer-only tool**

In `src/index.ts`:

- create `let reviewFindings = []` inside `register()`;
- when `isReviewer`, register `report_finding` using `FindingParamsSchema`;
- append via `addFinding()`;
- return JSON text containing current `finding` and `verdict`.

**Step 6: Ensure parent receives structured metadata**

Current `parseSubagentResult()` already supports `metadata`. Make the reviewer prompt require final output shape:

```json
{
  "text": "human-readable review summary",
  "metadata": {
    "verdict": "approve|comment|request-changes",
    "findings": []
  }
}
```

If the review shortcut in `src/index.ts` currently just notifies raw result text, update it to parse and render verdict/findings when metadata exists. If metadata is absent, display raw text with a warning that the review was unstructured.

**Step 7: Run targeted tests**

Run:

```bash
bun test tests/review/findings.test.ts tests/review/report-finding-tool.test.ts tests/review/reviewer-result.test.ts
```

Expected: PASS.

**Step 8: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

**Step 9: Commit**

```bash
git add src/index.ts src/agents/result.ts agent/agents tests/review/report-finding-tool.test.ts tests/review/reviewer-result.test.ts
git commit -m "feat: report structured review findings"
```

---

## Task 9: Task Tool Structured Result Contract Only

**Files:**
- Modify: `src/agents/task-tool.ts`
- Modify: `tests/agents/task-tool.test.ts`

**Step 1: Write failing result-contract tests**

Append to `tests/agents/task-tool.test.ts`:

```ts
describe("task structured result contract", () => {
  it("formats a successful task result as JSON-compatible data", () => {
    const result = formatTaskRunResult({
      id: "AuditPolicy",
      type: "explore",
      goal: "Inspect policy code",
      text: "done",
      ok: true,
    });

    expect(result).toEqual({
      id: "AuditPolicy",
      type: "explore",
      goal: "Inspect policy code",
      text: "done",
      ok: true,
    });
  });
});
```

Import `formatTaskRunResult` from `../../src/agents/task-tool`.

**Step 2: Run test to verify failure**

Run: `bun test tests/agents/task-tool.test.ts`

Expected: FAIL because structured result type/helper does not exist.

**Step 3: Add structured result type/helper**

In `src/agents/task-tool.ts`, add:

```ts
export interface TaskRunResult {
  id?: string;
  type: AgentType;
  goal: string;
  text: string;
  ok: boolean;
  artifact?: string;
  metadata?: Record<string, unknown>;
}

export function formatTaskRunResult(result: TaskRunResult): TaskRunResult {
  return result;
}
```

Keep this intentionally boring. Do not execute batches yet.

**Step 4: Run targeted tests**

Run: `bun test tests/agents/task-tool.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/agents/task-tool.ts tests/agents/task-tool.test.ts
git commit -m "feat: define task result contract"
```

---

## Task 10: Task Batch Schema Validation Without Parallel Execution

**Files:**
- Modify: `src/agents/task-tool.ts`
- Modify: `tests/agents/task-tool.test.ts`

**Step 1: Write failing batch schema tests**

Append to `tests/agents/task-tool.test.ts`:

```ts
describe("task batch schema", () => {
  it("accepts typed task batches", () => {
    expect(Value.Check(TaskBatchParamsSchema, {
      tasks: [
        { id: "AuditPolicy", type: "explore", goal: "Inspect policy code" },
        { id: "AuditSpecs", type: "explore", goal: "Inspect spec code" },
      ],
    })).toBe(true);
  });

  it("rejects duplicate batch ids with helper validation", () => {
    expect(() => validateTaskBatch([
      { id: "Same", type: "explore", goal: "A" },
      { id: "Same", type: "explore", goal: "B" },
    ])).toThrow(/duplicate/i);
  });
});
```

Import `TaskBatchParamsSchema` and `validateTaskBatch`.

**Step 2: Run test to verify failure**

Run: `bun test tests/agents/task-tool.test.ts`

Expected: FAIL because batch schema/helper does not exist.

**Step 3: Add batch schema and validation**

In `src/agents/task-tool.ts`:

```ts
export const TaskBatchItemSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  type: Type.Optional(Type.Union(AGENT_TYPES.map((t) => Type.Literal(t)))),
  goal: Type.String({ minLength: 1 }),
  context: Type.Optional(Type.String()),
});

export const TaskBatchParamsSchema = Type.Object({
  tasks: Type.Array(TaskBatchItemSchema, { minItems: 1 }),
});

export interface TaskBatchItem {
  id: string;
  type?: AgentType;
  goal: string;
  context?: string;
}

export function validateTaskBatch(tasks: TaskBatchItem[]): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    ids.add(task.id);
  }
}
```

Do not union batch params into `TaskParamsSchema` yet unless registration handles it in the same task. A schema that accepts batches before execution supports them is a contract bug.

**Step 4: Run targeted tests**

Run: `bun test tests/agents/task-tool.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/agents/task-tool.ts tests/agents/task-tool.test.ts
git commit -m "feat: add task batch validation"
```

---

## Task 11: Documentation Sync After Implemented Behavior

**Files:**
- Modify: `README.md`
- Modify: `CONTEXT.md` only if implementation reveals terminology drift
- Modify: `docs/adr/0003-extension-first-agent-distribution.md` only if implementation changes the decision

**Step 1: Update README only for shipped behavior**

Document:

- `interaction` capability at a high level;
- Ask Tool v1 single-question behavior;
- Todo Tool session-local behavior;
- Report Finding Tool reviewer flow;
- Task result/batch contract only if exposed to users.

Do not document:

- Ask forms;
- parallel task execution;
- `/todo` slash command unless implemented;
- artifact references unless implemented.

**Step 2: Verify docs against code**

Read the README section and schemas together:

```bash
git diff -- README.md CONTEXT.md docs/adr/0003-extension-first-agent-distribution.md
```

Expected: docs match implemented features only.

**Step 3: Run verification**

Run targeted suite:

```bash
bun test tests/governance/tool-call.test.ts tests/permissions/rules.test.ts tests/spec/evidence.test.ts tests/hooks/after-tool.test.ts tests/interaction/ask.test.ts tests/interaction/ask-tool.test.ts tests/interaction/todo.test.ts tests/interaction/todo-tool.test.ts tests/review/findings.test.ts tests/review/report-finding-tool.test.ts tests/review/reviewer-result.test.ts tests/agents/task-tool.test.ts
```

Expected: PASS.

Run:

```bash
bun run typecheck
bun run lint
```

Expected: PASS.

**Step 4: Commit**

```bash
git add README.md CONTEXT.md docs/adr/0003-extension-first-agent-distribution.md
git commit -m "docs: document governed interaction primitives"
```

---

## Task 12: Final Verification

**Files:**
- No code changes expected.

**Step 1: Run full CI**

Run: `bun run ci`

Expected: PASS.

**Step 2: Inspect worktree**

Run: `git status --short`

Expected: clean if committing after each task, or only intentional uncommitted files.

**Step 3: Manual smoke test only if Pi can be run locally**

Verify interactively:

- `ask` appears as an active tool in main sessions.
- `todo` appears as an active tool in main sessions.
- reviewer subagent sees `report_finding`.
- non-reviewer subagents do not see `report_finding`.
- task result contracts remain backward-compatible.

Do not claim this smoke test passed unless actually run.

## Recommended Implementation Stop Points

Stop for review after:

1. Task 2: `interaction` capability + post-execution audit/evidence plumbing.
2. Task 4: Ask Tool registered.
3. Task 6: Todo Tool registered.
4. Task 8: Report Finding end-to-end.
5. Task 10: Task result/batch contract.
