# Pi Setup Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the Thanos todo tool to Claude-Code-style live rendering + branch-safe persistence, raise the four thin specialist prompts to the oracle/researcher standard, de-duplicate the Exa integration, and commit the curated skills set.

**Architecture:** Five independent phases ordered by impact. Phase 1 (todo) adopts Pi's own reference pattern from `agent/npm/node_modules/@earendil-works/pi-coding-agent/examples/extensions/todo.ts`: state lives in tool-result `details`, is reconstructed from the session branch on `session_start`/`session_tree`, and is rendered inline via `renderResult` plus a full-screen `/todo` view via `ctx.ui.custom`. Phase 2 edits markdown agent definitions only. Phases 3–5 are config/docs/git hygiene with no TypeScript changes.

**Tech Stack:** TypeScript, `typebox`, Pi Extension API (`ExtensionAPI`, `ExtensionContext`, `@earendil-works/pi-tui` `Text`), `vitest`, `eslint`.

**Conventions:** DRY, YAGNI, TDD, frequent commits. Run `bun run typecheck`, `bun run lint`, and `bun run test` (or scoped `vitest run <file>`) as the gates. Each phase ends with a commit. Phases are independent — they can be done in any order, but this is the recommended sequence.

---

## Phase 1 — Claude-Code-style todo (live render + branch-safe state)

The todo state currently lives in a module-global (`src/index.ts:108` `let todoState`) plus a module-global counter (`src/interaction/todo.ts:5` `_todoIdCounter`). This is lost on session reload and wrong after a branch. The tool also returns markdown text only — no rendered panel. We fix both by carrying `TodoState` in the tool result's `details`, reconstructing from the session branch, and adding inline + full-screen rendering.

### Task 1.1: Seed the id counter from existing state (kill the global-counter bug)

**Files:**
- Modify: `src/interaction/todo.ts`
- Test: `tests/interaction/todo.test.ts`

**Step 1: Write the failing test**

Add to `tests/interaction/todo.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createTodoState, seedTodoIds, importTodoMarkdown } from "../../src/interaction/todo";

describe("seedTodoIds", () => {
  it("makes the next created item id exceed the max id already present", () => {
    const restored = importTodoMarkdown("# TODO\n\n## A\n- [x] one\n- [ ] two\n");
    // Force the restored items to have high numeric ids.
    restored.phases[0].items[0].id = "40";
    restored.phases[0].items[1].id = "41";
    seedTodoIds(restored);
    const next = createTodoState([{ phase: "B", items: ["fresh"] }]);
    expect(Number(next.phases[0].items[0].id)).toBeGreaterThan(41);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/interaction/todo.test.ts -t seedTodoIds`
Expected: FAIL — `seedTodoIds is not a function`.

**Step 3: Write minimal implementation**

In `src/interaction/todo.ts`, after `nextTodoId`:

```typescript
/** Re-seed the id counter so newly created items never collide with restored ids. */
export function seedTodoIds(state: TodoState): void {
  let max = 0;
  for (const phase of state.phases) {
    for (const item of phase.items) {
      const n = Number(item.id);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  if (max > _todoIdCounter) _todoIdCounter = max;
}
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/interaction/todo.test.ts -t seedTodoIds`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/interaction/todo.ts tests/interaction/todo.test.ts
git commit -m "fix(todo): seed id counter from restored state to avoid id collisions"
```

---

### Task 1.2: Carry TodoState in tool-result `details` and reconstruct from the session branch

**Files:**
- Modify: `src/index.ts` (todo tool registration at `src/index.ts:1232-1248`, and `let todoState` at `src/index.ts:108`)
- Modify: `src/interaction/todo.ts` (export a stable `EMPTY_TODO_STATE` and a `TODO_DETAILS_KEY` marker type)
- Test: `tests/interaction/todo-tool.test.ts`

**Step 1: Add the details type + empty-state export (no test yet — types)**

In `src/interaction/todo.ts`:

```typescript
export interface TodoDetails {
  kind: "thanos-todo";
  state: TodoState;
}

export const EMPTY_TODO_STATE: TodoState = { phases: [] };

export function makeTodoDetails(state: TodoState): TodoDetails {
  return { kind: "thanos-todo", state };
}
```

**Step 2: Write the failing test**

Add to `tests/interaction/todo-tool.test.ts` a reconstruction test. Build a fake branch of session entries and assert state is rebuilt:

```typescript
import { describe, it, expect } from "vitest";
import { reconstructTodoState } from "../../src/interaction/todo";
import { createTodoState, makeTodoDetails } from "../../src/interaction/todo";

describe("reconstructTodoState", () => {
  it("rebuilds the latest todo state from the most recent todo toolResult on the branch", () => {
    const earlier = createTodoState([{ phase: "P1", items: ["a", "b"] }]);
    const later = createTodoState([{ phase: "P1", items: ["a", "b", "c"] }]);
    const branch = [
      { type: "message", message: { role: "toolResult", toolName: "todo", details: makeTodoDetails(earlier) } },
      { type: "message", message: { role: "toolResult", toolName: "todo", details: makeTodoDetails(later) } },
      { type: "message", message: { role: "toolResult", toolName: "other", details: { kind: "x" } } },
    ];
    const result = reconstructTodoState(branch as never);
    expect(result.phases[0].items).toHaveLength(3);
  });

  it("returns empty state when no todo results are present", () => {
    expect(reconstructTodoState([] as never).phases).toHaveLength(0);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `bunx vitest run tests/interaction/todo-tool.test.ts -t reconstructTodoState`
Expected: FAIL — `reconstructTodoState is not a function`.

**Step 4: Write minimal implementation**

In `src/interaction/todo.ts`:

```typescript
interface BranchEntryLike {
  type?: string;
  message?: { role?: string; toolName?: string; details?: unknown };
}

/** Rebuild todo state by scanning the session branch for the latest todo toolResult details. */
export function reconstructTodoState(branch: readonly BranchEntryLike[]): TodoState {
  let state: TodoState = EMPTY_TODO_STATE;
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg || msg.role !== "toolResult" || msg.toolName !== "todo") continue;
    const details = msg.details as TodoDetails | undefined;
    if (details && details.kind === "thanos-todo" && details.state) {
      state = details.state;
    }
  }
  seedTodoIds(state);
  return state;
}
```

**Step 5: Run test to verify it passes**

Run: `bunx vitest run tests/interaction/todo-tool.test.ts -t reconstructTodoState`
Expected: PASS.

**Step 6: Wire reconstruction + details into `src/index.ts`**

- Update the import at `src/index.ts:40`:

```typescript
import {
  createTodoState, applyTodoOperation, exportTodoMarkdown, reconstructTodoState,
  makeTodoDetails, EMPTY_TODO_STATE, TodoParamsSchema,
  type TodoOperation, type TodoState, type TodoDetails,
} from "./interaction/todo";
```

- Leave `let todoState: TodoState = createTodoState([]);` at `src/index.ts:108` (it is now just the live cache; source of truth is `details`).

- In the existing `pi.on("session_start", ...)` handler (`src/index.ts:132`) and add a `session_tree` handler, reconstruct:

```typescript
todoState = reconstructTodoState(ctx.sessionManager.getBranch());
ctx.ui.setStatus("harness-todo", todoStatusSegment(ctx, todoState));
```

Add a sibling handler near the other `pi.on(...)` registrations:

```typescript
pi.on("session_tree", async (_event, ctx) => {
  todoState = reconstructTodoState(ctx.sessionManager.getBranch());
  ctx.ui.setStatus("harness-todo", todoStatusSegment(ctx, todoState));
});
```

- Replace the todo tool `execute` body (`src/index.ts:1237-1247`) so every result carries `details`:

```typescript
async execute(_toolCallId, params: TodoOperation) {
  try {
    if (params.op === "export") {
      return {
        content: [{ type: "text" as const, text: exportTodoMarkdown(todoState) }],
        details: makeTodoDetails(todoState),
      };
    }
    todoState = applyTodoOperation(todoState, params);
    return {
      content: [{ type: "text" as const, text: exportTodoMarkdown(todoState) }],
      details: makeTodoDetails(todoState),
    };
  } catch (err) {
    return { content: [{ type: "text" as const, text: String(err) }], isError: true, details: undefined };
  }
},
```

**Step 7: Run gates**

Run: `bun run typecheck && bunx vitest run tests/interaction`
Expected: PASS (the `todoStatusSegment` reference will fail typecheck until Task 1.4 — if implementing strictly task-by-task, temporarily stub `const todoStatusSegment = (_c: unknown, _s: TodoState) => undefined;` and remove it in Task 1.4).

**Step 8: Commit**

```bash
git add src/interaction/todo.ts src/index.ts tests/interaction/todo-tool.test.ts
git commit -m "feat(todo): carry state in tool-result details and reconstruct from session branch"
```

---

### Task 1.3: Inline live render — `renderResult` + `renderCall` on the todo tool

This is the Claude-Code panel: each todo tool call renders the current checklist inline in the transcript instead of dumping markdown.

**Files:**
- Create: `src/interaction/todo-render.ts`
- Modify: `src/index.ts` (add `renderCall`/`renderResult` to the todo tool; import `Text`)
- Test: `tests/interaction/todo-render.test.ts`

**Step 1: Write the failing test**

Create `tests/interaction/todo-render.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderTodoLines } from "../../src/interaction/todo-render";
import { createTodoState, applyTodoOperation } from "../../src/interaction/todo";
import { noopTheme } from "../../src/ui-utils";

describe("renderTodoLines", () => {
  it("marks completed, in-progress, and pending items distinctly and shows a count", () => {
    let state = createTodoState([{ phase: "Setup", items: ["one", "two", "three"] }]);
    state = applyTodoOperation(state, { op: "done", task: "one" });
    const lines = renderTodoLines(state, noopTheme).join("\n");
    expect(lines).toContain("Setup");
    expect(lines).toContain("one");      // completed
    expect(lines).toContain("two");      // now in_progress
    expect(lines).toMatch(/1\/3/);       // completion count
  });

  it("renders an empty hint when there are no phases", () => {
    const lines = renderTodoLines(createTodoState([]), noopTheme).join("\n");
    expect(lines.toLowerCase()).toContain("no todos");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/interaction/todo-render.test.ts`
Expected: FAIL — cannot find `../../src/interaction/todo-render`.

**Step 3: Write minimal implementation**

Create `src/interaction/todo-render.ts`:

```typescript
import type { TodoState, TodoStatus } from "./todo";

// Minimal theme shape we depend on (compatible with Pi's Theme and noopTheme).
interface ThemeLike {
  fg(color: string, text: string): string;
  bold?(text: string): string;
}

function glyph(status: TodoStatus, theme: ThemeLike): string {
  if (status === "completed") return theme.fg("success", "✓");
  if (status === "in_progress") return theme.fg("accent", "▶");
  if (status === "abandoned") return theme.fg("dim", "✗");
  return theme.fg("dim", "○");
}

function countDone(state: TodoState): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const phase of state.phases) {
    for (const item of phase.items) {
      total += 1;
      if (item.status === "completed") done += 1;
    }
  }
  return { done, total };
}

/** Render the todo checklist as themed lines (Claude-Code-style panel). */
export function renderTodoLines(state: TodoState, theme: ThemeLike): string[] {
  if (state.phases.length === 0) {
    return [theme.fg("dim", "No todos")];
  }
  const { done, total } = countDone(state);
  const lines: string[] = [theme.fg("muted", `Todo  ${done}/${total} done`)];
  for (const phase of state.phases) {
    lines.push(theme.fg("toolTitle", `  ${phase.name}`));
    for (const item of phase.items) {
      const g = glyph(item.status, theme);
      const text =
        item.status === "completed" || item.status === "abandoned"
          ? theme.fg("dim", item.content)
          : item.status === "in_progress"
            ? theme.fg("text", item.content)
            : theme.fg("muted", item.content);
      lines.push(`  ${g} ${text}`);
      for (const note of item.notes) {
        lines.push(theme.fg("dim", `      ↳ ${note}`));
      }
    }
  }
  return lines;
}

/** Compact one-line summary for the statusline, e.g. "todo:2/8". */
export function todoSummary(state: TodoState): string | undefined {
  const { done, total } = countDone(state);
  if (total === 0) return undefined;
  return `todo:${done}/${total}`;
}
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/interaction/todo-render.test.ts`
Expected: PASS.

**Step 5: Add `renderCall`/`renderResult` to the todo tool in `src/index.ts`**

Add `import { Text } from "@earendil-works/pi-tui";` near the top imports, and `import { renderTodoLines, todoSummary } from "./interaction/todo-render";`. Then extend the `pi.registerTool({ name: "todo", ... })` object with:

```typescript
renderCall(args, theme) {
  return new Text(theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", String(args.op)), 0, 0);
},
renderResult(result, _opts, theme) {
  const details = result.details as TodoDetails | undefined;
  const state = details?.kind === "thanos-todo" ? details.state : EMPTY_TODO_STATE;
  return new Text(renderTodoLines(state, theme).join("\n"), 0, 0);
},
```

**Step 6: Run gates**

Run: `bun run typecheck && bunx vitest run tests/interaction`
Expected: PASS.

**Step 7: Commit**

```bash
git add src/interaction/todo-render.ts src/index.ts tests/interaction/todo-render.test.ts
git commit -m "feat(todo): inline live checklist rendering via renderResult"
```

---

### Task 1.4: `/todo` full-screen view command + statusline segment

**Files:**
- Modify: `src/index.ts` (register `/todo` command; define `todoStatusSegment`)
- Modify: `README.md` (document `/todo` and the `todo:` status segment)
- Test: manual (UI command — covered by render unit tests; no headless assertion)

**Step 1: Define the status helper**

In `src/index.ts`, near the other status helpers:

```typescript
function todoStatusSegment(ctx: ExtensionContext, state: TodoState): string | undefined {
  const s = todoSummary(state);
  return s ? ctx.ui.theme.fg("accent", s) : undefined;
}
```

Remove the temporary stub from Task 1.2 Step 7 if it was added.

**Step 2: Register the `/todo` command**

Add near the other `pi.registerCommand(...)` blocks (model after `/modes` at `src/index.ts:216`):

```typescript
pi.registerCommand("todo", {
  description: "Show the current todo checklist for this branch",
  handler: async (args, ctx) => {
    const trimmed = args.trim();
    if (trimmed === "export") {
      ctx.ui.notify(exportTodoMarkdown(todoState), "info");
      return;
    }
    if (!ctx.hasUI) {
      ctx.ui.notify(exportTodoMarkdown(todoState), "info");
      return;
    }
    const theme = ctx.ui.theme;
    await ctx.ui.custom<void>((_tui, _theme, kb, done) => ({
      handleInput(data: string) {
        if (kb.matchesKey(data, "escape") || kb.matchesKey(data, "ctrl+c")) done();
      },
      render(width: number) {
        const lines = ["", ...renderTodoLines(todoState, theme), "", theme.fg("dim", "  Press Escape to close")];
        return lines.map((l) => l.slice(0, width));
      },
    }));
  },
  getArgumentCompletions: (prefix) =>
    "export".startsWith(prefix) ? [{ value: "export", label: "export markdown" }] : null,
});
```

> Note: verify the exact `ctx.ui.custom` component contract against the installed Pi version (`agent/npm/node_modules/@earendil-works/pi-coding-agent/examples/extensions/todo.ts` uses `new TodoListComponent(...)` with `handleInput`/`render`/`invalidate`). Match that shape; if `kb.matchesKey` is not the local API, use the `matchesKey` import from `@earendil-works/pi-tui` as the example does.

**Step 3: Update the status segment wherever todo state changes**

After every `todoState = applyTodoOperation(...)` in the tool `execute`, the inline render already reflects state, but the statusline updates on session events. That is sufficient for v1; optionally call `ctx.ui.setStatus("harness-todo", ...)` from a `tool_result` hook if live statusline updates per-call are desired (YAGNI for now).

**Step 4: Run gates**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: PASS (315+ tests).

**Step 5: Update README**

In `README.md`, add `/todo` to the Thanos slash commands table and add `todo:<done>/<total>` to the status-bar segment description.

**Step 6: Commit**

```bash
git add src/index.ts README.md
git commit -m "feat(todo): /todo view command and todo status segment; docs"
```

---

## Phase 2 — Raise the four thin specialist prompts to standard

`build.md`, `explore.md`, `plan.md`, `reviewer.md` are one-liners; `oracle.md`/`researcher.md` are structured. Bring the four up to the same standard: Core Responsibilities → Process → Quality Standards → Output Format (Result-Contract-aware) → Definition of Done. **Keep the existing frontmatter (`tools`, `maxTurns`, `timeoutMs`) unchanged** — only expand the prompt body.

### Task 2.1: Rewrite `explore.md`, `plan.md`, `build.md`, `reviewer.md`

**Files:**
- Modify: `agent/agents/explore.md`, `agent/agents/plan.md`, `agent/agents/build.md`, `agent/agents/reviewer.md`
- Test: `tests/agents/registry.test.ts` (verify all agent files still parse with valid frontmatter)

**Step 1: Confirm the contract shape to reference**

From `CONTEXT.md` (Subagent Result Contract) and `src/agents/result.ts`, every subagent returns `{ status, summary, findings[], artifacts[], escalations[], metadata }`. Prompts must guide the model to populate `summary` and `findings[]` well and to use **artifact references** for large output (write to `.harness/...` and reference, not inline).

**Step 2: Rewrite each body** (preserve frontmatter). Example for `reviewer.md`:

```markdown
---
tools: read, ls, find, grep, task, report_finding
maxTurns: 30
---
You are Reviewer, a meticulous code reviewer. You assess correctness, security, regressions, and missing tests — you do not edit code or run commands.

**Core responsibilities**
1. Find correctness bugs, security issues, and regressions in the changed code.
2. Identify missing or weak tests for the behavior under review.
3. Produce structured, evidence-backed findings — never vague prose.

**Process**
1. Establish scope: read the diff/target and the files it touches before judging.
2. Trace each change against its intended behavior and surrounding invariants.
3. When the blast radius is unclear, spawn an `explore` subagent (depth 1) to map callers — do not guess.
4. Record each issue with `report_finding`: priority P0–P3, file + line, what's wrong, why it matters, and a concrete fix.

**Quality standards**
- Every non-trivial claim cites a file and line.
- Severity is calibrated: P0 = data loss/security/break; P1 = likely bug; P2 = maintainability; P3 = nit.
- No style nits dressed up as defects. No invented objections.

**Output format**
Return the Subagent Result Contract. Put the aggregate verdict and the single most important issue in `summary`; put every issue in `findings[]`. Write long evidence dumps to an artifact and reference it rather than inlining.

**Definition of done**
A verdict (approve / approve-with-nits / request-changes) justified by the collected findings, with the highest-severity issue stated first.
```

Apply the same structure to `explore.md` (map-and-report, evidence-backed, no edits), `plan.md` (sequenced steps, risks, verification plan, no edits), and `build.md` (minimal verified edits in the worktree ceiling, run/verify before reporting, summarize the diff in `summary`).

**Step 3: Run the registry test**

Run: `bunx vitest run tests/agents/registry.test.ts`
Expected: PASS (frontmatter still valid).

**Step 4: Commit**

```bash
git add agent/agents/explore.md agent/agents/plan.md agent/agents/build.md agent/agents/reviewer.md
git commit -m "feat(agents): expand thin specialist prompts to Result-Contract-aware standard"
```

---

## Phase 3 — De-duplicate Exa + sync MCP docs

Exa is configured twice — as an MCP server in `mcp.json` and as the `pi-web-access` provider in `web-search.json`. The README also marks `neon`/`stitch`/`exa` as disabled while `mcp.json` has them active. Resolve to a single Exa path (pi-web-access, per the README's own statement) and make the docs match reality.

### Task 3.1: Remove the redundant Exa MCP server and reconcile docs

**Files:**
- Modify: `mcp.json` (remove the `exa` server block; decide on `neon`/`stitch`)
- Modify: `mcp.example.json` (mirror the change so fresh installs match)
- Modify: `README.md` (MCP table reflects the actual enabled set)

**Step 1: Decision gate** — confirm pi-web-access is the kept Exa path (README already says so). If yes:
- Remove the `"exa": { ... }` block from `mcp.json` and `mcp.example.json`.
- For `neon`/`stitch`: either remove them from `mcp.json` or update the README table to mark them **active**. Pick one so docs and config agree.

**Step 2: Verify JSON validity**

Run: `node -e "JSON.parse(require('fs').readFileSync('mcp.json','utf8')); JSON.parse(require('fs').readFileSync('mcp.example.json','utf8')); console.log('ok')"`
Expected: `ok`.

**Step 3: Reconcile the README MCP table** so every row's status matches `mcp.json`.

**Step 4: Commit**

```bash
git add mcp.example.json README.md
git commit -m "docs(mcp): drop redundant exa server, sync MCP table with actual config"
```

> `mcp.json` is gitignored, so only `mcp.example.json` + README are committed; edit the local `mcp.json` directly as part of the same change.

---

## Phase 4 — Commit the curated skills set

`git status` shows deleted skills (`api-design-principles` assets, `supabase-postgres-best-practices`, `vercel-*`, `ui-ux-pro-max`, `web-design-guidelines`) and 11 untracked new skills (`api-designer`, `deslop`, `emil-design-eng`, `fastapi-expert`, `nextjs-developer`, `rust-engineer`, `thermo-nuclear-*`, `typescript-best-practices`, `wordpress-pro`, `writing-prds`). The 67-skill working set is not reflected in version control, so a fresh install won't match.

### Task 4.1: Stage and commit the skills delta

**Files:**
- Stage: all of `agent/skills/` (additions + deletions)
- Also: `agent/run-history.jsonl` is modified — decide whether to track it or gitignore it (it's session noise; recommend adding to `.gitignore`).

**Step 1: Review the delta**

Run: `git status --short agent/skills && git diff --stat`
Expected: the deletions + new untracked dirs listed in the review.

**Step 2: Decide on run-history**

`agent/run-history.jsonl` is local session telemetry. Recommend: add `agent/run-history.jsonl` to `.gitignore` and `git rm --cached` it. Confirm before doing so.

**Step 3: Stage and commit**

```bash
git add agent/skills
git commit -m "chore(skills): commit curated skill set (add 11, remove stale 6)"
```

---

## Phase 5 — Delete the stale backup agent file

`agent/agents/designer.huashu-rich.bak-20260519-214848.md` is a leftover. The loader reads agents by exact `${type}.md`, so it never registers (harmless) — but it's clutter in a live directory.

### Task 5.1: Remove the `.bak` file

**Files:**
- Delete: `agent/agents/designer.huashu-rich.bak-20260519-214848.md`

**Step 1: Confirm it is not referenced**

Run: `grep -rn "huashu-rich" src tests agent/agents 2>/dev/null`
Expected: no references outside the file itself.

**Step 2: Remove and commit**

```bash
git rm "agent/agents/designer.huashu-rich.bak-20260519-214848.md"
git commit -m "chore(agents): remove stale designer backup file"
```

---

## Final verification

After all phases:

```bash
bun run typecheck && bun run lint && bun run test
```

Expected: typecheck clean, 0 lint errors, all tests pass (315 + the ~4 new todo tests).

Manual smoke (interactive Pi session):
1. Ask the agent to do a multi-step task; confirm `todo` calls render an inline checklist with `▶`/`✓`/`○` glyphs and a `done/total` count.
2. Run `/todo`; confirm the full-screen panel renders and Escape closes it.
3. Confirm the `todo:<done>/<total>` statusline segment appears.
4. Branch the session (or reload); confirm the todo list survives and reflects the branch point.
5. Delegate a `reviewer` task; confirm findings come back structured per the Result Contract.

---

## Notes on sequencing & risk

- **Phase 1 is the highest-value and highest-risk** (touches session-state semantics and tool rendering). Verify the `ctx.ui.custom` and `renderResult` signatures against the installed Pi version's example before writing — the API shape there is authoritative.
- **Phases 2–5 are low-risk** and independent; Phase 5 is a 2-minute cleanup that can go first if you want an easy warm-up commit.
- No phase changes the governance spine, policy, or the subagent contract code — Phase 2 only edits prompt prose, so existing tests remain valid.
