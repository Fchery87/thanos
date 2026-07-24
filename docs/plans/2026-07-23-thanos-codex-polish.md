# Thanos ← Codex Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the eight gaps surfaced by the Codex-CLI architecture review — starting with a confirmed system-prompt regression — to make the Thanos harness durable, cache-efficient, better-contained, and structurally coherent.

**Architecture:** Thanos is a governance/workflow **extension layer** on top of the Pi runtime (`@earendil-works/pi-coding-agent`); it does not own the agent loop. Every change here lives at that layer: the `before_agent_start` prompt assembly, the `.harness/` state directory, a launcher wrapper, the runtime wiring, and config resolution. No change touches Pi itself.

**Tech Stack:** TypeScript (strict:false, ESM), Bun runtime, Vitest, ESLint. Tests run with `bun run test <path>` (= `vitest run <path>`). Typecheck: `bun run typecheck`. Lint: `bun run lint`. Full gate: `bun run ci`.

**Key facts established during grilling (do not re-derive):**
- Pi's `before_agent_start` hands the handler the **base system prompt** as `event.systemPrompt`; whatever the handler returns as `systemPrompt` **replaces** it wholesale (`agent-session.js:882`). Base includes the `<available_skills>` block, AGENTS.md context files, tool prompt snippets, and Pi's base instructions (`system-prompt.js` via `buildSystemPrompt`).
- Thanos's handler (`register-harness.ts:1600-1710`) builds `systemPrompt` from its own content and **never folds in `event.systemPrompt`** → **CONFIRMED regression**: parent turns drop the base prompt every turn. Masked (not absent) because skills also surface via a SessionStart hook and tools work via the API `tools` field.
- Pi puts a single `cache_control` breakpoint on the whole system prompt (`cacheControlFormat: "anthropic"`). Any per-turn change to it is a full prefix cache miss. The **roster is already session-static** (good); the dynamic contaminants are `memories` and `goalDirective`.
- `before_agent_start` handlers may return `{ systemPrompt?, message? }`; `message` is a single custom message `{ customType, content, display?, details? }` aggregated into the turn's `messages[]` (`runner.js:807-838`, `runner.d.ts:14-16`). Conversation-tail messages sit **after** the cached prefix, so moving dynamic context there preserves the cache.
- The `tool_call` hook can only **allow/block** — it **cannot rewrite** a command (`runner.js:648-665`). Therefore command-level `bwrap` wrapping is impossible; sandboxing must be **launcher-level** (wrap the `pi` process).

**Branching (Q11):** one feature branch + PR per Task-group (item), grouped by phase, off `master`. Never commit to `master`. Consider a dedicated git worktree per phase.

**Verification bar (Q10):** every task ends green on `bun run typecheck` + `bun run lint` + the touched suite; each phase ends green on full `bun run test`. Behaviour-changing items get a characterization test first.

---

## Phase 0 — Correctness (do first, ship independently)

### Task 1: Characterize the base-prompt drop (failing test)

**Files:**
- Test: `tests/runtime/before-agent-start-prompt.test.ts` (create)

**Step 1: Write the failing characterization test.** This encodes the *desired* behaviour: the assembled parent system prompt must contain the base prompt Pi passed in.

```ts
import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "../../src/runtime/prompt-assembly";

describe("assembleSystemPrompt", () => {
  it("folds the base system prompt in first, then Thanos static blocks", () => {
    const out = assembleSystemPrompt({
      baseSystemPrompt: "BASE-<available_skills>...</available_skills>",
      isSubagent: false,
      trustedInstructions: ["TRUSTED"],
      skillsDirective: "SKILLS",
      roster: "- explore: search",
    });
    expect(out.systemPrompt.startsWith("BASE-")).toBe(true);
    expect(out.systemPrompt).toContain("TRUSTED");
    expect(out.systemPrompt).toContain("- explore: search");
  });

  it("keeps dynamic content (memories, goal) OUT of systemPrompt", () => {
    const out = assembleSystemPrompt({
      baseSystemPrompt: "BASE",
      isSubagent: false,
      trustedInstructions: ["T"],
      skillsDirective: "S",
      roster: "R",
      memoriesBlock: "MEM",
      goalDirective: "GOAL",
    });
    expect(out.systemPrompt).not.toContain("MEM");
    expect(out.systemPrompt).not.toContain("GOAL");
    expect(out.dynamicMessage).toContain("MEM");
    expect(out.dynamicMessage).toContain("GOAL");
  });

  it("is byte-identical across turns when only memories/goal change (cache stability)", () => {
    const base = { baseSystemPrompt: "BASE", isSubagent: false, trustedInstructions: ["T"], skillsDirective: "S", roster: "R" } as const;
    const turnA = assembleSystemPrompt({ ...base, goalDirective: "GOAL-A", memoriesBlock: "M1" });
    const turnB = assembleSystemPrompt({ ...base, goalDirective: "GOAL-B", memoriesBlock: "M2" });
    expect(turnA.systemPrompt).toBe(turnB.systemPrompt);
  });

  it("returns no systemPrompt override for subagents (keeps Pi base)", () => {
    const out = assembleSystemPrompt({ baseSystemPrompt: "BASE", isSubagent: true, trustedInstructions: [], skillsDirective: "", roster: "" });
    expect(out.systemPrompt).toBeUndefined();
  });
});
```

**Step 2: Run it, verify it fails.** Run: `bun run test tests/runtime/before-agent-start-prompt.test.ts`. Expected: FAIL — `assembleSystemPrompt` / `src/runtime/prompt-assembly` does not exist.

**Step 3: Commit the red test.**
```bash
git checkout -b fix/system-prompt-fold-in
git add tests/runtime/before-agent-start-prompt.test.ts
git commit -m "test(runtime): characterize system-prompt fold-in and cache stability"
```

---

### Task 2: Extract a pure `assembleSystemPrompt`

**Files:**
- Create: `src/runtime/prompt-assembly.ts`

**Step 1: Implement the pure assembler.** Session-static blocks go in `systemPrompt` (prefixed by the base); per-turn-dynamic blocks go in `dynamicMessage`. Returning `systemPrompt: undefined` for subagents preserves Pi's base.

```ts
export interface SystemPromptInput {
  baseSystemPrompt: string;
  isSubagent: boolean;
  trustedInstructions: string[];
  skillsDirective: string;
  roster: string;            // session-static (roster.ts already freezes it)
  memoriesBlock?: string;    // per-turn dynamic → tail message
  goalDirective?: string;    // per-turn dynamic → tail message
}

export interface AssembledPrompt {
  /** undefined = keep Pi's base prompt (subagents, or nothing to add). */
  systemPrompt?: string;
  /** Rendered dynamic context for a custom tail message, or undefined. */
  dynamicMessage?: string;
}

export function assembleSystemPrompt(input: SystemPromptInput): AssembledPrompt {
  if (input.isSubagent) return {};

  const staticBlocks = [
    input.baseSystemPrompt,
    input.trustedInstructions.join("\n\n"),
    input.skillsDirective,
    input.roster,
  ].filter(Boolean);

  const dynamicBlocks = [input.memoriesBlock, input.goalDirective].filter(Boolean) as string[];

  return {
    systemPrompt: staticBlocks.length ? staticBlocks.join("\n\n") : undefined,
    dynamicMessage: dynamicBlocks.length ? dynamicBlocks.join("\n\n") : undefined,
  };
}
```

**Step 2: Run test, verify pass.** Run: `bun run test tests/runtime/before-agent-start-prompt.test.ts`. Expected: PASS (all four).

**Step 3: Commit.**
```bash
git add src/runtime/prompt-assembly.ts
git commit -m "feat(runtime): pure assembleSystemPrompt folding base + splitting dynamic context"
```

---

### Task 3: Wire `assembleSystemPrompt` into `before_agent_start`

**Files:**
- Modify: `src/runtime/register-harness.ts:1659-1709` (the assembly + return)
- Reference (do not change): `src/context/broker.ts` (still used to render memory/roster blocks)

**Step 1: Render the blocks, call the assembler, return `{ systemPrompt, message }`.** Replace the current `promptAssembly`/`systemPrompt`/`return` region. Roster and memories are still rendered by `assemblePrompt` (broker), but now split by destination. `event.systemPrompt` is the base.

```ts
// event.systemPrompt is Pi's base prompt (skills block, AGENTS.md, tool snippets).
const roster = isSubagent ? [] : await loadRoster();
const rendered = assemblePrompt({
  isSubagent,
  memories,
  roster,
  goalCondition: goalSnap?.status === "active" ? goalSnap.condition : undefined,
  trustedInstructions: [], // trusted instructions are static; pass them straight to the assembler below
});

const assembled = assembleSystemPrompt({
  baseSystemPrompt: event.systemPrompt ?? "",
  isSubagent,
  trustedInstructions: isSubagent ? [] : TRUSTED_INSTRUCTIONS, // hoist the existing array to a module const
  skillsDirective,
  roster: isSubagent ? "" : formatRoster(roster),
  memoriesBlock: rendered.memoriesMessage,     // see Task 3 note: split broker output
  goalDirective,
});

return {
  ...(assembled.systemPrompt ? { systemPrompt: assembled.systemPrompt } : {}),
  ...(assembled.dynamicMessage
    ? { message: { customType: "harness-context", content: assembled.dynamicMessage, display: false } }
    : {}),
};
```

**Note (broker split):** `assemblePrompt` currently fuses memories+roster+goal into one `contextMessage`. Split its return so callers can route each block: add `memoriesMessage?: string` (rendered memory envelope only) and keep `roster`/`goal` out of `contextMessage` since Task 3 renders roster via `formatRoster` and goal via `goalDirective`. Update `tests/context/*` and any `assemblePrompt` unit test accordingly (grep: `bun run test tests/context tests/prompts`).

**Step 2: Verify the display shape of a custom message.** Confirm `content` accepts a plain string (else wrap as `[{ type: "text", text: assembled.dynamicMessage }]`). Check `node_modules/@earendil-works/pi-coding-agent/dist/core/messages.d.ts` (`CustomMessage.content`) and adjust the literal. Add an assertion to the Task 1 test if the shape is an array.

**Step 3: Add an integration guard.** In `tests/index.test.ts` (or a new `tests/index.prompt-fold.test.ts`), drive the registered `before_agent_start` with a fake `event.systemPrompt = "BASE-SENTINEL"` and assert the returned `systemPrompt` contains `BASE-SENTINEL`. Expected: FAIL before Step 1 wiring, PASS after.

**Step 4: Run touched suites.** Run: `bun run test tests/runtime tests/context tests/prompts tests/index.test.ts && bun run typecheck && bun run lint`. Expected: PASS.

**Step 5: Commit.**
```bash
git add src/runtime/register-harness.ts src/context/broker.ts tests/
git commit -m "fix(runtime): restore Pi base prompt and move dynamic context off the cached prefix"
```

**Step 6: Open PR.** `gh pr create -t "fix(runtime): system-prompt fold-in + cache hygiene" -B master`. Body must state: the confirmed regression, the cache-stability fix, and that skills/AGENTS/tool-guidelines are restored to the parent prompt.

---

### Task 4: Persist goal state to `.harness/goal-state.json` (failing test)

**Files:**
- Create: `src/goal/store.ts`
- Test: `tests/goal/store.test.ts` (create)

**Step 1: Write the failing roundtrip test.**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveGoalState, loadGoalState, clearGoalState } from "../../src/goal/store";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "goal-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

it("roundtrips an active goal keyed by repo path", async () => {
  await saveGoalState(dir, { condition: "all tests pass", status: "active", repo: dir });
  const loaded = await loadGoalState(dir, dir);
  expect(loaded).toEqual({ condition: "all tests pass", status: "active", repo: dir });
});

it("does not restore when the repo path differs", async () => {
  await saveGoalState(dir, { condition: "x", status: "active", repo: "/other/repo" });
  expect(await loadGoalState(dir, dir)).toBeUndefined();
});

it("clearGoalState removes the file (achieved goals never restore)", async () => {
  await saveGoalState(dir, { condition: "x", status: "paused", repo: dir });
  await clearGoalState(dir);
  expect(await loadGoalState(dir, dir)).toBeUndefined();
});

it("returns undefined (never throws) on a missing/corrupt file", async () => {
  expect(await loadGoalState(dir, dir)).toBeUndefined();
});
```

**Step 2: Run, verify fail.** Run: `bun run test tests/goal/store.test.ts`. Expected: FAIL — module missing.

**Step 3: Implement the store.** Writes to `<repo>/.harness/goal-state.json` (already gitignored dir). Reuses `GoalPersistPayload` from `src/goal/persist.ts`, extended with `repo`.

```ts
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GoalPersistPayload } from "./persist";

export interface StoredGoal extends GoalPersistPayload { repo: string; }

function path(repo: string): string { return join(repo, ".harness", "goal-state.json"); }

export async function saveGoalState(repo: string, state: StoredGoal): Promise<void> {
  const p = path(repo);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, `${JSON.stringify(state, null, 2)}\n`);
}

export async function loadGoalState(repo: string, expectedRepo: string): Promise<StoredGoal | undefined> {
  try {
    const raw = JSON.parse(await readFile(path(repo), "utf-8")) as StoredGoal;
    if (!raw || raw.repo !== expectedRepo || (raw.status !== "active" && raw.status !== "paused")) return undefined;
    if (typeof raw.condition !== "string" || raw.condition.trim() === "") return undefined;
    return raw;
  } catch { return undefined; }
}

export async function clearGoalState(repo: string): Promise<void> {
  try { await rm(path(repo), { force: true }); } catch { /* best effort */ }
}
```

**Step 4: Run, verify pass.** Run: `bun run test tests/goal/store.test.ts`. Expected: PASS.

**Step 5: Commit.**
```bash
git checkout -b feat/goal-resume
git add src/goal/store.ts tests/goal/store.test.ts
git commit -m "feat(goal): durable goal-state store under .harness"
```

---

### Task 5: Save on transitions; restore on `session_start`

**Files:**
- Modify: `src/runtime/register-harness.ts:1282-1291` (`recordGoalEvent`) and `:250` (`session_start`) and `:180` (controller construction)

**Step 1: Persist on every goal event.** Wrap `recordGoalEvent` so `goal_set`/`goal_paused` save, `goal_achieved` clears.

```ts
const recordGoalEvent = async (event: { type: "goal_set" | "goal_achieved" | "goal_paused"; summary: string; outcome: string }) => {
  await recordHarnessEvent(event); // existing ledger write
  const repo = process.cwd();
  if (event.type === "goal_achieved") { await clearGoalState(repo); return; }
  const payload = serializeGoal(goalController);
  if (payload) await saveGoalState(repo, { ...payload, repo });
};
```

**Step 2: Restore in `session_start` (parent only).** After the `if (!mcpManager) return;` guard and delivery resolution, before status rendering:

```ts
if (!isSubagent) {
  const repo = process.cwd();
  const stored = await loadGoalState(repo, repo);
  if (stored && ctx.isProjectTrusted()) {
    const tokens = ctx.getContextUsage()?.tokens ?? 0;
    const restored = restoreController(stored, goalSettings, () => Date.now(), tokens);
    goalController.adoptFrom(restored); // see Step 3
    ctx.ui.setStatus("harness-goal", renderGoalStatusSegment(goalController.snapshot()));
    ctx.ui.notify(`◎ /goal restored (${stored.status}) — ${stored.condition}. ${stored.status === "paused" ? "Run /goal resume." : "Continuing."}`, "info");
  }
}
```

**Step 3: Add `GoalController.adoptFrom`.** The controller is constructed once at module scope (`:180`); expose a method to overwrite its internal state from another instance rather than reconstructing. Add to `src/goal/controller.ts`:

```ts
/** Replace this controller's state with another's (used by session restore). */
adoptFrom(other: GoalController): void {
  this.g = other.snapshotInternal();
}
```
Add a package-private `snapshotInternal(): Internal | undefined { return this.g ? { ...this.g } : undefined; }`. Unit-test both in `tests/goal/controller.set.test.ts`.

**Step 4: Decision — do NOT auto-continue an active restored goal.** Restore leaves the goal `active` but does not inject a continuation directive on `session_start` (the loop advances on `agent_end`; auto-firing work on launch is surprising). The status line + notify tell the user; their next message (or `/goal resume` for paused) drives it. Document this in the notify copy above.

**Step 5: Run.** Run: `bun run test tests/goal tests/index.test.ts && bun run typecheck && bun run lint`. Expected: PASS.

**Step 6: Commit + PR.**
```bash
git add src/runtime/register-harness.ts src/goal/controller.ts tests/goal/
git commit -m "feat(goal): persist on transitions and restore on session_start"
gh pr create -t "feat(goal): cross-session goal resume" -B master
```

---

## Phase 1 — Safety & convergence

### Task 6: Launcher-level sandbox — feasibility spike (timeboxed)

**Files:**
- Create: `scripts/sandbox-spike.sh` (throwaway; delete after)

**Step 1: Prove `bwrap` confines writes to the repo.** Manually run:
```bash
bwrap --dev-bind / / --bind "$PWD" "$PWD" --ro-bind /usr /usr --chdir "$PWD" \
  --unshare-all --share-net -- bash -c 'touch ./in-repo && (touch /etc/nope 2>&1 || echo "blocked /etc OK")'
```
Expected: `./in-repo` created; `/etc/nope` blocked. Record the exact working invocation.

**Step 2: Decide bind policy.** Confirm the minimal binds that still let `pi` + `bun` + `git` + the model network call work: rw-bind repo root + `$TMPDIR` + `~/.pi` (auth/config) + `~/.cache`; ro-bind toolchain; `--share-net`. Note any tool that breaks.

**Step 3: Record findings** in the PR description for Task 7; delete the spike script. No commit of the script.

---

### Task 7: `thanos` launcher wrapper with delivery-gated sandbox

**Files:**
- Create: `src/security/sandbox.ts` (pure policy: decide + build argv)
- Create: `scripts/thanos-launch.mjs` (the wrapper binary)
- Modify: `package.json` (`bin.thanos` → `./scripts/thanos-launch.mjs`)
- Test: `tests/security/sandbox.test.ts` (create)

**Step 1: Write the failing policy test.**

```ts
import { describe, it, expect } from "vitest";
import { shouldSandbox, buildBwrapArgv } from "../../src/security/sandbox";

describe("shouldSandbox", () => {
  const on = { platform: "linux", bwrapAvailable: true } as const;
  it("engages for no-mistakes", () => expect(shouldSandbox({ ...on, mode: "no-mistakes", autonomy: "attended", yolo: false }).sandbox).toBe(true));
  it("engages for unattended", () => expect(shouldSandbox({ ...on, mode: "local-only", autonomy: "unattended", yolo: false }).sandbox).toBe(true));
  it("engages when yolo on", () => expect(shouldSandbox({ ...on, mode: "direct-PR", autonomy: "attended", yolo: true }).sandbox).toBe(true));
  it("skips ordinary attended local-only", () => expect(shouldSandbox({ ...on, mode: "local-only", autonomy: "attended", yolo: false }).sandbox).toBe(false));
  it("never sandboxes off-linux", () => expect(shouldSandbox({ platform: "darwin", bwrapAvailable: true, mode: "no-mistakes", autonomy: "unattended", yolo: true }).sandbox).toBe(false));
  it("no-mistakes + missing bwrap = DENY", () => expect(shouldSandbox({ platform: "linux", bwrapAvailable: false, mode: "no-mistakes", autonomy: "attended", yolo: false }).action).toBe("deny"));
  it("other modes + missing bwrap = warn-fallthrough", () => expect(shouldSandbox({ platform: "linux", bwrapAvailable: false, mode: "local-only", autonomy: "unattended", yolo: false }).action).toBe("warn"));
});

describe("buildBwrapArgv", () => {
  it("rw-binds repo + tmp, ro-binds toolchain, shares net", () => {
    const argv = buildBwrapArgv({ repo: "/r", tmp: "/t", home: "/h", inner: ["pi", "--foo"] });
    expect(argv[0]).toBe("bwrap");
    expect(argv).toContain("/r"); // bound
    expect(argv.slice(-2)).toEqual(["pi", "--foo"]);
  });
});
```

**Step 2: Run, verify fail.** Run: `bun run test tests/security/sandbox.test.ts`. Expected: FAIL.

**Step 3: Implement `sandbox.ts`** (pure functions only — decision + argv from the spike-verified invocation). `shouldSandbox` returns `{ sandbox: boolean; action: "run" | "warn" | "deny"; reason }`.

**Step 4: Implement `scripts/thanos-launch.mjs`.** Resolve delivery for `cwd` (reuse the delivery resolver — Task 12 will formalize it; for now import `resolveDelivery`), detect `bwrap` on PATH, call `shouldSandbox`. On `deny`: print reason, exit 1. On `warn`: print warning, exec `pi` unsandboxed. On sandbox: `execvp` `buildBwrapArgv({... inner: ["pi", ...userArgs]})`. Else exec `pi` directly. Keep it dependency-free.

**Step 5: Run + typecheck + lint.** Run: `bun run test tests/security/sandbox.test.ts && bun run typecheck && bun run lint`. Expected: PASS.

**Step 6: Manual smoke.** In a `no-mistakes` repo, launch via the wrapper, confirm a `touch /etc/x` from within a Thanos bash call is blocked; in an ordinary attended repo, confirm no sandbox and normal operation.

**Step 7: Commit + PR.**
```bash
git checkout -b feat/launcher-sandbox
git add src/security/sandbox.ts scripts/thanos-launch.mjs package.json tests/security/sandbox.test.ts
git commit -m "feat(security): delivery-gated launcher-level bwrap sandbox (linux)"
gh pr create -t "feat(security): launcher-level exec containment" -B master
```
PR body: document that this is launcher-level (tool_call cannot rewrite commands), Linux-only v1, network allowed v1, and the `no-mistakes`-missing-`bwrap`=deny rule.

---

### Task 8: Delete the dormant legacy subagent spawn path

**Files:**
- Modify: `src/agents/execution.ts` (`buildSubagentEnv`), `src/agents/child-role.ts`
- Tests: `tests/agents/child-role.test.ts`, `tests/agents/execution.test.ts`

**Step 1: Prove the legacy path is dead.** Run:
```bash
grep -rn "HARNESS_SUBAGENT\|buildSubagentEnv" src/ | grep -v "child-role.ts\|execution.ts"
```
Expected: only the live pi-subagents contract (`PI_SUBAGENT_CHILD*`) is referenced by callers; no live dispatcher sets `HARNESS_SUBAGENT`. If a live caller exists, STOP and reassess — do not delete.

**Step 2: Update the tests first (red).** In `tests/agents/child-role.test.ts`, delete the legacy `HARNESS_SUBAGENT` cases and keep only the `PI_SUBAGENT_CHILD_AGENT` contract. In `execution.test.ts`, drop `buildSubagentEnv` legacy-role assertions. Run: `bun run test tests/agents/child-role.test.ts tests/agents/execution.test.ts`. Expected: FAIL (references removed symbols).

**Step 3: Collapse `child-role.ts`** to the live contract only:
```ts
export interface ChildRoleEnv { PI_SUBAGENT_CHILD?: string; PI_SUBAGENT_CHILD_AGENT?: string; }
export function isSubagentProcess(env: ChildRoleEnv): boolean { return env.PI_SUBAGENT_CHILD === "1"; }
export function detectChildRole(env: ChildRoleEnv): string | undefined { return env.PI_SUBAGENT_CHILD_AGENT || undefined; }
```
Remove `HARNESS_SUBAGENT` from `buildSubagentEnv` (and the `reviewer` special-case — `report_finding` is registered for every subagent since commit c45744d). If `buildSubagentEnv` becomes unused, delete it and its import sites.

**Step 4: Full agent suite.** Run: `bun run test tests/agents && bun run typecheck && bun run lint`. Expected: PASS.

**Step 5: Commit + PR.**
```bash
git checkout -b refactor/drop-legacy-subagent-path
git add src/agents/ tests/agents/
git commit -m "refactor(agents): remove dormant legacy HARNESS_SUBAGENT spawn path"
gh pr create -t "refactor(agents): single live subagent path" -B master
```

---

## Phase 2 — Structure

### Task 9: Characterization tests for `register-harness` before decomposing

**Files:**
- Test: `tests/runtime/register-harness.smoke.test.ts` (create)

**Step 1: Write behaviour-locking tests** covering what the decomposition must not break: registers commands (`/goal`, `/todo`, `/yolo`, `/delivery`, `/ship`, `/mcp`, `/thinking`, `/models`, `/modes`, `/remember`, `/memory`), registers the `spec` flag, and installs `session_start` / `before_agent_start` / `tool_call` / `agent_end` / `model_select` handlers. Drive a fake `ExtensionAPI` recording `registerCommand`/`registerFlag`/`on` calls; assert the set.

**Step 2: Run, verify pass** against current code (this is a *characterization* baseline, not TDD-red). Run: `bun run test tests/runtime/register-harness.smoke.test.ts`. Expected: PASS.

**Step 3: Commit.**
```bash
git checkout -b refactor/decompose-register-harness
git add tests/runtime/register-harness.smoke.test.ts
git commit -m "test(runtime): characterize register-harness surface before decomposition"
```

---

### Task 10: Decompose `register-harness.ts` + type `setupRuntime` (paired)

**Files:**
- Create: `src/runtime/commands/` (one file per command: `goal.ts` already exists in `src/goal/command.ts` — move the *registration* wrappers here for the others), `src/runtime/session-start.ts`, `src/runtime/before-agent-start.ts`, `src/runtime/model-events.ts`
- Modify: `src/runtime/register-harness.ts` (becomes a thin composition root), `src/runtime/register-events.ts` (`setupRuntime` signature), `tsconfig.strict-boundaries.json`

**Step 1: Extract in behaviour-preserving slices.** Move one handler/command group at a time; after each move run `bun run test tests/runtime/register-harness.smoke.test.ts && bun run typecheck`. Expected: PASS after every slice. Commit per slice (`refactor(runtime): extract <X> from register-harness`).

**Step 2: Replace the `any`s in `setupRuntime`.** In `register-events.ts`, type the params (currently `getDelivery: () => Promise<any>`, `getPolicyState`, `permissions`, `spec`, `lens`, `goalController`) with the real interfaces: `ResolvedDelivery`, `PolicyState`, `PermissionsManager`, `SpecEngine`, `Lens`, `GoalController`. Import from their modules; export any missing public interface. Run: `bun run typecheck`. Expected: PASS (fix real type mismatches surfaced — do not `as any`).

**Step 3: Extend strict boundaries.** Add `"src/runtime/**/*.ts"` to `include` in `tsconfig.strict-boundaries.json`. Run: `tsc --noEmit -p tsconfig.strict-boundaries.json`. Fix violations. Expected: PASS.

**Step 4: Full gate.** Run: `bun run ci`. Expected: PASS.

**Step 5: PR.**
```bash
gh pr create -t "refactor(runtime): decompose register-harness + type setupRuntime" -B master
```
PR body: emphasize zero behaviour change (smoke test unchanged) and strict-boundaries coverage added.

---

### Task 11: `resolveConfig()` — one documented precedence

**Files:**
- Create: `src/config/resolve.ts`
- Test: `tests/config/resolve.test.ts` (create)

**Step 1: Write the failing precedence test.** Encode the real order: env override > captain registry (`agent/projects.json`) > untrusted ship-file subset (`.thanos/delivery.json`, only `gates`/`defaultBranch`/`merge`) > built-in defaults. Assert a ship file smuggling `mode`/`autonomy`/`yolo` is ignored (trust-split), matching `governance/delivery.ts`.

**Step 2: Run, verify fail.** Run: `bun run test tests/config/resolve.test.ts`. Expected: FAIL.

**Step 3: Implement `resolveConfig`** as a thin, pure orchestrator over the *existing* loaders (do not change file formats or move keys). It composes `resolveDelivery` + policy preset + settings into one typed `ResolvedConfig` with the documented precedence. Reuse existing parse/trust logic; this is consolidation, not new policy.

**Step 4: Run, verify pass + typecheck + lint.** Expected: PASS.

**Step 5: Document.** Add a precedence table to `docs/configuration.md` (this is a docs edit, allowed — the "pure code" exclusion applied only to the grill inputs, not deliverables). Note the file is documentation of the new resolver.

**Step 6: Commit + PR.**
```bash
git checkout -b feat/config-resolver
git add src/config/resolve.ts tests/config/resolve.test.ts docs/configuration.md
git commit -m "feat(config): single documented resolveConfig precedence"
gh pr create -t "feat(config): unified config resolution" -B master
```

---

### Task 12: Repo hygiene — redirect `.bak` writes, purge strays

**Files:**
- Modify: every settings/models writer that emits `*.bak` (grep below)
- Modify: `.gitignore`

**Step 1: Find the backup writers and strays.**
```bash
grep -rn "\.bak\|bak-\|backup" src/ scripts/
git ls-files | grep -E "\.bak" # tracked strays
ls agent/*.bak* agent/settings.json.bak* 2>/dev/null # untracked strays
```

**Step 2: Redirect writers** to `.harness/backups/<name>.<ISO>.bak`. Add a tiny helper `backupPath(name)` in `src/observability/` if more than one writer needs it (DRY).

**Step 3: Purge strays.** `git rm` any tracked `*.bak*`; delete untracked ones under `agent/` (`models.json.bak-*`, `settings.json.bak-*`, `skills.bak-dist`, etc.). Add `**/*.bak` and `.harness/backups/` to `.gitignore` (confirm `.harness/` already ignored).

**Step 4: Verify clean.** Run: `git status --short` (no stray `.bak`), then `bun run ci`. Expected: PASS.

**Step 5: Commit + PR.**
```bash
git checkout -b chore/backup-hygiene
git add -A
git commit -m "chore: write config backups under .harness, purge stray .bak files"
gh pr create -t "chore: config backup hygiene" -B master
```

---

## Phase 3 — Design-only (no code)

### Task 13: Permission-surface mapping doc (2-axis target)

**Files:**
- Create: `docs/plans/2026-07-23-permission-surface-2axis-design.md`

**Step 1: Write the mapping.** A table translating today's five axes (`yolo × autonomy{attended,unattended} × deliveryMode{local-only,direct-PR,no-mistakes} × preset × specScope`) onto the target two orthogonal axes: **approval posture** {attended-prompt, auto-within-ceiling, never-prompt(≈yolo)} × **containment level** {read-only, workspace-write, full}. Show where the Task 7 sandbox slots into "containment," and which current combinations are redundant or contradictory.

**Step 2: Enumerate migration risks** and a non-breaking rollout (shim old flags → new axes). Explicitly mark this as a *separate future plan*; no code in this task.

**Step 3: Commit.**
```bash
git checkout -b docs/permission-2axis
git add docs/plans/2026-07-23-permission-surface-2axis-design.md
git commit -m "docs: permission-surface 2-axis mapping and migration design"
```

---

## Execution order & dependencies

1. **Phase 0** (Tasks 1–5) — independent, highest value. Task 1-3 (one PR), Task 4-5 (one PR).
2. **Phase 1** (Tasks 6–8) — Task 6 spike gates Task 7. Task 8 is independent.
3. **Phase 2** (Tasks 9–12) — Task 9 gates Task 10. Land Task 10 **after** Phase 0 (avoids churn on `register-harness.ts`). Tasks 11–12 independent.
4. **Phase 3** (Task 13) — anytime; informs a later separate redesign.

**Cross-cutting rule:** if any task's premise proves wrong at implementation time (e.g., the custom-message `content` shape in Task 3, or a live legacy caller in Task 8), STOP and use superpowers:systematic-debugging / re-grill rather than forcing the plan.
