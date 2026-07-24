# Thanos harness vs. Codex CLI — architecture review & polish rundown

_Date: 2026-07-23. Scope: how Thanos wires subagents, orchestration, goals, extensions,
and governance, compared against OpenAI's Codex CLI (`openai/codex`, the `codex-rs`
Rust workspace), to extract concrete polish opportunities._

---

## 0. TL;DR

Thanos and Codex are **not the same kind of artifact**, and that reframes the whole
comparison:

- **Codex CLI is an engine.** ~70–84 Rust crates that *own* the agent loop, the wire
  protocol, tool dispatch, the kernel sandbox, context compaction, and session
  persistence. It is a self-contained runtime.
- **Thanos is a governance + workflow layer** that rides *on top of* the Pi runtime
  (`@earendil-works/pi-coding-agent`). It does **not** own the loop — it hooks Pi's
  lifecycle events (`session_start`, `tool_call`, `agent_end`, `model_select`, …) and
  registers commands. Pi owns the loop, the model client, context, and rendering.

So most of Codex's headline engineering (Rust rewrite, kernel sandbox, SQ/EQ protocol,
owning the turn loop) is **not directly actionable** for Thanos — that's Pi's layer, not
yours. The *actionable* lessons are the ones that live at your layer: **context-cache
discipline, config resolution, session durability, sandbox tiering, path convergence,
and internal type contracts.** Thanos is genuinely *ahead* of Codex on team governance;
it's *behind* on durability, context economics, and internal coherence.

---

## 1. How Codex CLI is wired (the relevant parts)

| Layer | Codex mechanism |
|---|---|
| **Entry** | `codex-cli` multitool → `codex-tui` (interactive) or `codex-exec` (headless). `exec` now routes through `InProcessAppServerClient` — the *same* plumbing as IDE integration. |
| **Loop** | Three nested loops: `submission_loop` (Tokio task, whole-session) → turn loop (per `Op::UserTurn`) → inner tool loop (tool call → result → feed back until `done`). |
| **Protocol** | Async **Submission Queue / Event Queue**. UI pushes `Op` (`UserTurn`, `Interrupt`, `Shutdown`); engine emits `EventMsg` (`TurnStarted`, `ExecCommandBegin/End`, `PatchApplied`, `TokensUsed`, …). TUI/exec/app-server are *pure event consumers* — fully decoupled from the engine. |
| **Threads** | `ThreadManager` orchestrates a primary `CodexThread` + sub-agent threads, each with its **own `ContextManager`** (message history + token accounting). |
| **Context** | `ContextManager` auto-compacts at ~95% window (`CompactTask` → structured summary), and **deliberately orders the prompt (system → tools → dev-instructions → input) to keep a stable cacheable prefix**. Measured: stable prefix = 85% cache hit, ~65% lower latency, ~71% lower cost vs. a perturbed prefix. |
| **Tools** | `ToolRouter` → 3 backends: shell (`UnifiedExecProcessManager`, PTY), `apply_patch` (structured, diffable edits — *not* raw shell writes), MCP. Approval gate is an enum (`UnlessTrusted` / `OnRequest` / `Never`), persisted across resume. |
| **Sandbox** | **Kernel-level**, applied to the whole process tree: Landlock+seccomp (Linux), Seatbelt (macOS), restricted tokens (Windows). `arg0` self-dispatch re-invokes the same binary as the sandbox helper. Policies: `read-only` / `workspace-write` / `danger-full-access`. |
| **Config** | `codex-config` `ConfigBuilder`: CLI flags > env > project `config.toml` > `~/.codex/config.toml` > compiled defaults. One deterministic resolver. |
| **Persistence** | Threads backed by **SQLite `StateDB`** + compressed JSONL (`.jsonl.zst`) rollout files. Survive restart; resume / fork / rollback / audit. |
| **IDE** | `codex-app-server` exposes the engine over JSON-RPC 2.0; TS schemas generated from Rust types (never hand-edited). |
| **Test discipline** | `insta` snapshot tests mandatory for any TUI change; schema exports generated, not edited. |

## 2. How Thanos is wired (as built)

- **Extension entry:** `src/index.ts` → `registerHarness(pi)`. Everything is `pi.on(...)`
  hooks + `pi.registerCommand(...)`. Pi owns the loop; Thanos governs it.
- **Governance gate** (`runtime/register-events.ts` → `governance-runtime.ts`): every
  `tool_call` is classified by **risk tier** (`low/medium/high/critical`) + **capability**
  (`read/edit/exec/interaction`) and run through an ordered pipeline —
  *immutable delivery denies → policy deny → explicit-spec scope → yolo → autonomy →
  interactive prompt*. Deny always wins; yolo short-circuits only the *remaining* prompts.
- **Delivery modes** (`governance/delivery*.ts`): `local-only` / `direct-PR` /
  `no-mistakes`, each pinning a policy preset and shaping `/ship`. **Trust-split**: mode +
  autonomy + yolo-lock come only from the *captain registry* (`agent/projects.json`,
  trusted); the committed `.thanos/delivery.json` (untrusted) supplies only build
  mechanics. A repo can't escalate its own autonomy.
- **Subagents** (`agents/*.ts`): spawned as **Pi subprocesses** (`child_process.spawn`),
  narrowed capability ceiling, role-based (`explore/plan/build/reviewer/designer/oracle/
  researcher/evaluator/scout/worker`), **single-level leaf** (task tool gated behind
  `!isSubagent`). Structured `SubagentResultContract`. Per-role model routing via
  `subagents.agentOverrides` (+ `savedAgentOverrides` stash, toggle).
- **Orchestration:** `AgentOrchestrator` (max width 8, non-overlapping write scopes) and
  `WavesRuntime` (`/waves`, max 16 slices, max 3 waves, verified handoffs).
- **Goal loop** (`goal/*.ts`, ADR 0007): `/goal` sets a durable objective. A
  `ContinuationArbiter` makes goal/spec/budget **mutually exclusive** continuation
  drivers. Completion is *agent-signaled* then confirmed by a fresh, tool-less
  `completeSimple` evaluator. Ceilings **pause** (resumable), never clear.
- **Spec engine** (`spec/*.ts`): default-fail acceptance criteria, evidence-based
  verification gate that re-injects unmet criteria instead of letting the agent stop.
- **Security** (`security/*.ts`): pre-critical **git-stash snapshot** (non-destructive,
  `stash create`+`store`) + **Lens Lite** secret scan. **No kernel sandbox.**
- **Evolution ledger:** failures (gate re-injections, delivery-gate failures, review
  disagreements, goal transitions) logged as JSONL — "failures as harness training data."
- Config surface: `models.json`, `settings.json`, `projects.json`, `trust.json`, policy
  file, `.thanos/delivery.json`, `mcp.json`, `agent/extensions/subagent/config.json`.

---

## 3. Where Thanos is already *ahead* of Codex

Be honest about this — these are real differentiators, not to be "polished away":

1. **Team-grade governance.** Codex's approval model is a per-action enum. Thanos has a
   *durable policy ceiling + risk tiers + delivery travel-distance + trust-split + audit
   trail*. For shared/team workflows this is meaningfully more sophisticated than Codex.
2. **Delivery modes as a first-class axis.** "How far may this work travel" (local-only
   vs PR vs no-mistakes) is a concept Codex doesn't have. The captain/ship trust-split is
   a clean security instinct.
3. **Evidence-based spec gate.** Default-fail criteria that require a diff/passing
   command/manual evidence is stricter than Codex's model-driven ReAct recovery. A model
   cannot self-certify "done."
4. **Harness evolution ledger.** Treating agent failures as structured training data has
   no Codex equivalent.
5. **Single-driver continuation arbiter.** The goal/spec/budget mutual-exclusion is a
   clean little state machine — conceptually the same rigor as Codex's turn semantics,
   applied to *your* problem (competing "am I done?" mechanisms).

---

## 4. Gaps & polish opportunities (ranked, actionable)

### P0 — Context-cache discipline (highest ROI, lowest cost)
**Codex:** deliberately keeps a stable prompt prefix (system + tools + AGENTS.md) so
turns hit the prompt cache; mid-conversation changes to *tool availability, model, or
system content* bust the cache and cost ~3× latency / ~3.5× cost.
**Thanos:** commit #29 now *injects the subagent roster into the system prompt*, and
`setThinkingStatus` / status segments mutate session-visible state. Every dynamic thing
you put into the system-prompt prefix risks busting Pi's prompt cache **on every turn**.
**Action:** audit what Thanos injects into the system prompt vs. per-turn context. Roster
and thinking-status should live in a *stable* block (computed once at `session_start` and
frozen) or in late/user-role context — never re-computed into the prefix per turn. This
is a measurable win (Codex published 65–71% deltas) and costs almost nothing to fix.
Add a test asserting the injected system prefix is byte-identical across two turns.

### P0 — Session durability (resume/fork)
**Codex:** threads live in SQLite `StateDB` + `.jsonl.zst` rollouts; resume/fork/rollback
survive restart.
**Thanos:** ADR 0007 explicitly **defers** cross-session goal restore ("no confirmed
read-back of custom entries on `--resume`"). Goal/spec/wave state is session-scoped and
lost on restart. The pure `serializeGoal` / `restoreController` helpers are *already
written and tested* — just unwired.
**Action:** confirm Pi's `--resume` read path (or persist to `.harness/` yourself, which
you already do for the ledger) and wire goal restore. An active `/goal` surviving a
crash/restart is a flagship polish item that's 80% built.

### P1 — Sandbox tiering for `exec`
**Codex:** kernel-level isolation of the whole process tree; `workspace-write` is the
default, not full access.
**Thanos:** a `bash`/`exec` call classified "critical" still runs with **full host
access** once approved or under yolo. Your only containment is the git-stash snapshot —
which *by its own docstring* doesn't capture untracked files.
**Action:** this is where the delivery-mode model should pay off. Add an *optional*
sandbox tier (bwrap/Landlock on Linux, available and cheap) bound to
`no-mistakes` + `unattended`, or to yolo-on runs. You don't need Codex's 3-OS
implementation — a single Linux `bwrap` wrapper on the `exec` capability, gated by
delivery mode, closes the biggest hole in the "unattended" story. Frame it as
"workspace-write" analog: writes confined to repo root.

### P1 — Config resolution & repo hygiene
**Codex:** one documented, tested precedence resolver (`ConfigBuilder`).
**Thanos:** config is spread across 7+ files with no single documented precedence, and
the tree is littered with `*.bak` artifacts (`settings.json.bak-gpt-routing`,
`models.json.bak-*`, `settings.json.bak-pre-w2-*`, `skills.bak-dist`, …).
**Action:** (a) write one `resolveConfig()` with an explicit, tested precedence table
(the trust-split is already the right *instinct* — formalize the whole surface the same
way). (b) Stop leaving `.bak` files in the working tree — move snapshots under
`.harness/` (gitignored) like you already do for audit/evolution. This is pure polish but
it's the difference between "looks maintained" and "looks scattered."

### P1 — Kill the dual subagent path
**Codex:** unified exec/TUI/app-server through one client — a deliberate convergence
(PR #14005).
**Thanos:** two spawn contracts coexist — the "dormant legacy" `HARNESS_SUBAGENT` marker
(`"1"`/`"reviewer"`, `execution.ts`/`child-role.ts`) *and* the live pi-subagents engine
(`PI_SUBAGENT_CHILD_AGENT`). `detectChildRole` has to reconcile both. Your own memory
notes the legacy `src/agents` path is "dormant not dead."
**Action:** pick the live path, delete the legacy spawn + its env contract, collapse
`child-role.ts` to the single live contract. Codex's lesson is that *one* execution path
is worth a PR of its own.

### P2 — Type the internal contracts
**Codex:** protocol types are the spine; TS schemas are *generated* from Rust types so
they can't drift.
**Thanos:** `register-events.ts` passes `getDelivery: () => Promise<any>`,
`getPolicyState: () => Promise<any>`, `permissions: any`, `spec: any`, `lens: any`,
`goalController: any`. You have a `tsconfig.strict-boundaries.json` — the runtime wiring
is exactly where loose `any` erases the governance guarantees you worked hardest for.
**Action:** define the `GovernanceContext`/runtime interfaces once and thread them
through `setupRuntime`; add `src/runtime/**` to the strict-boundaries include set.

### P2 — Decompose the god-file
**Codex:** ~70 focused crates.
**Thanos:** `src/` is *nicely* modular — except `runtime/register-harness.ts` is **2019
lines** doing command registration + `session_start` + `model_select` + MCP UI + ship +
delivery + todo in one file.
**Action:** split by concern (`commands/`, `session-start.ts`, `model-events.ts`, …) the
same way the rest of `src/` is already organized. The modularity standard you hold
everywhere else just hasn't reached this file.

### P2 — Permission-surface coherence (you've already flagged this)
**Codex:** two clean orthogonal axes — approval enum (`UnlessTrusted/OnRequest/Never`) ×
sandbox policy (`read-only/workspace-write/full`).
**Thanos:** yolo × autonomy (attended/unattended) × delivery mode × policy preset × spec
scope. Powerful, but a 5-dimensional matrix is hard to reason about — your own memory
records the "#1 single-permissionMode redesign deferred."
**Action:** Codex is the argument *for* that redesign. Collapse toward two orthogonal
axes: **an approval posture** (attended prompt / auto-within-ceiling / never-prompt≈yolo)
× **a containment level** (read-only / workspace-write / full), with delivery mode
selecting defaults for both. That preserves every current capability with a surface a
user can hold in their head.

---

## 5. Prioritized punch list

| # | Item | Payoff | Effort |
|---|------|--------|--------|
| 1 | Freeze the system-prompt prefix (roster/thinking-status out of per-turn prefix) + prefix-stability test | 65–71% latency/cost on cache hits | S |
| 2 | Wire `serializeGoal`/`restoreController` for resume | Flagship durability; 80% built | S–M |
| 3 | Optional `bwrap`/Landlock sandbox on `exec`, gated by delivery mode | Closes the unattended full-host hole | M |
| 4 | One tested `resolveConfig()` + move `*.bak` out of the tree | Coherence + hygiene | S–M |
| 5 | Delete the dormant legacy subagent spawn path | Removes dual-path tech debt | M |
| 6 | Type `setupRuntime` args; add `runtime/**` to strict-boundaries | Restores governance type-safety | S |
| 7 | Decompose `register-harness.ts` (2019 → focused modules) | Matches your own modularity bar | M |
| 8 | Permission-surface redesign toward 2 orthogonal axes | The polish you already want | L |

**Do first:** #1 and #2 — highest payoff, already-written or near-zero-cost, and both are
things Codex demonstrably invested in that Thanos left on the table.

**Don't chase:** the Rust rewrite, kernel-3-OS sandbox parity, the SQ/EQ protocol, owning
the turn loop. Those are Pi's concerns. Thanos's job is to be the best *governance and
workflow layer* on top of Pi — and on that axis you're ahead of Codex; the gaps are
durability, context economics, containment, and internal coherence.
