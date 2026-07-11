# Governance

The Thanos Harness treats every tool call as a governed action: classified by risk,
evaluated against a policy ceiling, audited, and — when delegated — bounded by the same
ceiling in subagents.

## Permission gate

Every tool call is classified by risk tier and a capability:

| Tool | Risk | Capability |
|------|------|-----------|
| `read`, `ls`, `find`, `grep` | low | `read` |
| `write`, `edit` | high | `edit` |
| `bash` | critical | `exec` |
| `ask`, `todo`, `report_finding` | medium | `interaction` |

Each call is evaluated against the active policy ceiling (preset + any delivery overlay). The order of checks is: **yolo (if on) → policy/permission deny → autonomy → interactive prompt.** Deny always wins; autonomy can only auto-approve what the ceiling already allows.

Yolo mode is **default off** — the harness asks before high/critical actions. When yolo *is* turned on for a session it short-circuits to "allow" immediately (the Lens Lite secret scan still runs), letting rytswd `permission-gate` and `slow-mode` run independently. Yolo can be hard-disabled so it cannot be turned on at all — see [Yolo lockout](#yolo-lockout). To make a yolo-off setup frictionless on trusted repos, mark them `unattended` in the [captain registry](#delivery-modes).

## Context-mode execution guard

Thanos blocks unbounded context-mode execution calls:

- `ctx_execute`
- `ctx_execute_file`
- `ctx_batch_execute`

Those tools must include an explicit `timeout` and the timeout must be `<= 110000` ms. This prevents context-mode's Pi MCP bridge from hanging until its hard `120000` ms `tools/call` ceiling and surfacing:

```text
MCP request timeout after 120000ms: tools/call
```

Recommended timeouts:

| Use case | Timeout |
|----------|---------|
| quick inspection | `10000` ms |
| repository search / metadata scan | `30000` ms |
| tests / builds | `60000`–`90000` ms |
| server/daemon | `background: true` with a short timeout |

## Spec lifecycle

Thanos derives acceptance criteria from your prompt and verifies them after each run. Use `--spec` to require explicit approval before the first write. Criteria are **default-fail**: each one requires concrete evidence (a diff, a passing test/command, or explicit manual evidence) and stays false until that evidence is collected — so a model cannot self-certify completion by asserting it. A read-only `evaluator` specialist can grade the collected evidence against the criteria from a fresh context, and the [completion verification gate](guide.md#completion-verification-gate) re-injects unmet criteria instead of letting the agent stop.

## Harness evolution ledger

Thanos treats agent failures as harness training data. High-signal events — verification-gate re-injections, delivery-gate failures, review disagreements, wave-handoff rejections, and `/goal` lifecycle transitions (`goal_set` / `goal_achieved` / `goal_paused`) — are recorded as JSONL to `.harness/evolution/events.jsonl` (gitignored; summaries and artifact paths only, never prompts or secrets). Every deliberate harness change should carry a manifest entry answering: what failure evidence motivated it, the root cause, the exact component changed, the predicted improvement, the regression risk, and when to check whether it helped. See [harness-evolution.md](harness-evolution.md).

## Policy

Governance rules live in `harness.policy.json`, or in the file pointed to by `HARNESS_POLICY_FILE`.

```json
{
  "version": 1,
  "preset": "team",
  "rules": [],
  "audit": { "enabled": true },
  "headless": { "defaultDecision": "deny" }
}
```

Audit events are written to `.harness/audit.jsonl` (gitignored). View entries with `Ctrl+Shift+A`.

**Rule precedence:** Policy File rules use **first-match-wins**. Session-remembered rules use **last-match-wins**. The two layers are intentionally different: policy is deterministic; session overrides are recency-weighted.

## Delivery modes

A **delivery mode** decides how far a repo's work is allowed to travel and how autonomously Thanos may act in it. Each mode pins a base policy preset and shapes what `/ship` does.

| Mode | Preset | What it means |
|------|--------|---------------|
| `local-only` | `personal` | Work never leaves the machine. `git push` is denied; `/ship` performs a fast-forward-only local merge into the default branch. |
| `direct-PR` | `team` | Team flow; lands via PR. `/ship` is informational (Thanos does not push in v1). |
| `no-mistakes` | `ci` | Strictest preset for high-stakes repos. `/ship` is informational in v1. |

An unknown repo falls back to the safe default `local-only` / `attended` — Thanos never defaults to something more permissive.

Resolution reads two files:

- **Captain registry** — `~/.pi/agent/projects.json` (gitignored; trusted). Owns `mode`, `autonomy`, and the yolo lock. Matched per project by git remote URL (`match`) or absolute path (`path`), falling back to the top-level `default`.
- **Ship file** — `<repo>/.thanos/delivery.json` (committed; untrusted). Describes only how the repo builds: `gates`, `defaultBranch`, and `merge`.

A starter registry ships as [`agent/projects.example.json`](../agent/projects.example.json). Copy it to `~/.pi/agent/projects.json` and edit:

```json
{
  "version": 1,
  "default": { "mode": "local-only", "autonomy": "attended" },
  "projects": [
    { "match": "git@github.com:acme/payments.git", "mode": "no-mistakes", "autonomy": "unattended", "yolo": "locked" },
    { "path": "/home/you/code/website", "mode": "direct-PR", "autonomy": "attended" }
  ]
}
```

A repo's ship file only describes its build mechanics:

```json
{
  "version": 1,
  "gates": { "test": "bun run test", "typecheck": "bun run typecheck" },
  "defaultBranch": "main",
  "merge": "fast-forward"
}
```

### Trust-split

Mode, autonomy, and the yolo lock are **captain-owned**: they come only from the registry, never from the repo. The committed ship file is untrusted and only ever supplies `gates` / `defaultBranch` / `merge` — even if it smuggles in `mode`/`autonomy`/`yolo`, the resolver ignores those keys. A repo therefore cannot escalate its own autonomy or unlock yolo.

### Autonomy

- `attended` (default) — Thanos prompts as usual within the policy ceiling.
- `unattended` — auto-approves within the ceiling, so no prompts for allowed actions; **deny rules still block**. It is registry-only and can never be granted by a repo.

### Yolo lockout

Yolo can be hard-disabled for a session, which makes `/yolo` and `Ctrl+Shift+Y` refuse with "Yolo is disabled by configuration." Any of these locks it:

- env `THANOS_YOLO_DISABLED=1`
- registry top-level `"yolo": "disabled"`
- a matched project entry's `"yolo": "locked"`

### /ship

`/ship` delivers the current branch per the resolved mode, after you confirm required gates are green:

- **local-only** — fast-forward-only merge of the current branch into the local `defaultBranch`. It **never pushes**; it only advances your local default branch pointer. If the branches have diverged (no fast-forward possible) it reports the failure instead of force-merging.
- **direct-PR / no-mistakes** — informational only. Thanos does not push or open PRs in v1; confirm your gates and push / open the PR yourself.

> **Known limitation (local-only):** interposed-flag `git push` forms (e.g. `git -C <dir> push`, `git --no-pager push`) are now caught by an **argv-level classifier** (`shouldBlockLocalOnlyPush`), wired into the tool_call handler for local-only mode regardless of autonomy — closing the previous local-only + unattended gap. It leaves commit messages mentioning "push" alone (no false positives). The remaining uncaught surface is non-git uploaders (`scp`, `rsync`, `curl`/`wget`) and the `gh` publish family under interposed flags; extending the classifier to those is future work.

## Governed subagents

The `subagent` tool (pi-subagents; the legacy `task` tool is dormant behind `THANOS_LEGACY_TASK=1`) delegates work to a bounded **specialist subagent** — a separate `pi` subprocess spawned in JSON mode under the parent's policy as a ceiling. Subagents are a deliberate governance surface, not just parallelism:

- **Bounded nesting (depth ≤ 2).** The legacy `task` tool is suppressed inside subagents (`HARNESS_SUBAGENT` set), so that path is depth-1. The live pi-subagents `subagent` tool permits **one** further level — capped by `maxSubagentDepth` (engine default 2) — so a specialist can delegate a capability it deliberately lacks (e.g. the exec-denied `designer` delegating a render + screenshot to `build` for self-validation). A depth-2 child cannot spawn further, and subagents never talk to the user directly. Deeper nesting stays a recognized anti-pattern.
- **Policy ceiling inheritance.** Each subagent's capabilities are narrowed from the parent policy; read-only roles get hard `edit`/`exec` denies regardless of what the parent allows.

### Main-agent-as-orchestrator workflow

The recommended way to do non-trivial work: **drive the main session in natural language and let it orchestrate specialists**, rather than doing everything inline. The main agent (depth 0) holds the goal and context, dispatches bounded specialists for the parts they do best, and synthesizes their typed results. A goal with distinct phases (design → build → verify → critique) maps cleanly onto this.

Orchestration works at two altitudes that compose:

1. **Main agent → specialist (depth 0 → 1).** The default: call `designer`, `build`, `reviewer`, `oracle`, etc.
2. **Specialist → sub-specialist (depth 1 → 2).** A specialist delegates one level down to gain a capability it deliberately lacks — canonically, the exec-denied `designer` delegating a render + screenshot to `build` for its self-validation loop. You don't orchestrate this; it happens inside the specialist's run, capped at depth 2.

Both altitudes were validated live (2026-06-27) on a non-Anthropic model, so the pattern is model-agnostic. To exercise a specialist's *own* loop instead of having the main agent do the work for it, dispatch it verbatim: "invoke `<agent>` once and return its raw contract; do not orchestrate, build, screenshot, or critique yourself." Full guide: [main-agent-orchestrator-workflow.md](main-agent-orchestrator-workflow.md).

### Specialists

| Role | Writes? | Context | Purpose |
|------|---------|---------|---------|
| `explore` | read-only | fresh | Search and map the codebase; report findings |
| `plan` | read-only | fresh | Design an approach without touching files |
| `build` | **writer** | fresh (may fork) | Implement changes in an isolated worktree |
| `reviewer` | read-only | fresh | Structured P0–P3 review; may spawn `explore` at depth 1 |
| `designer` | **writer** (exec-denied) | fresh (may fork) | UI/UX implementation, review, design-system audit; delegates render/screenshot to `build` for its self-validation loop |
| `oracle` | read-only | fresh-only | Unbiased second opinion; challenges plans and diffs |
| `researcher` | read-only | fresh | Network-gated external research |
| `evaluator` | read-only | fresh | Grade implementation evidence against the active contract from a fresh context |

Each role maps to a markdown file in `agent/agents/` defining its system prompt, optional `tools` allowlist, `model`, and `context` mode.

In addition to the roles above, three **focused review critics** ship as agent files for the code-review jury: `reviewer-correctness`, `reviewer-security`, and `reviewer-tests`. They are read-only and each scoped to one concern.

### Code review jury

`Ctrl+Shift+R` no longer spawns a single reviewer. It dispatches a **heterogeneous critic jury**: `reviewer-correctness`, `reviewer-security`, and `reviewer-tests` run in **parallel** on the session diff (each pinnable to a different model family for independent blind spots — see [Per-role model routing](#per-role-model-routing)), an `oracle` runs as a **devil's advocate that challenges the findings even when the reviewers report nothing**, and a synthesis pass de-duplicates and ranks into one verdict (APPROVE / COMMENT / REQUEST_CHANGES). The main agent acts as judge and does not write findings itself. Independent confirmation across model families is the strongest review signal.

### Bounded waves (`/waves`)

`/waves <goal>` is an explicit opt-in orchestration for large research, analysis, audit, or carefully isolated implementation work. Rather than one linear pass, the main agent **discovers the problem shape, decomposes it into independent slices, fans out bounded parallel workers, verifies each structured handoff, and synthesizes one deliverable**. Waves are bounded — width and depth are capped, read slices may overlap but **write slices must own disjoint paths** and run in worktree-isolated writer agents (`build`/`worker`) — so parallelism never corrupts shared state. Verification of the handoffs is the stop function, not a fixed iteration count. See [main-agent-orchestrator-workflow.md](main-agent-orchestrator-workflow.md).

### Per-role model routing

Subagent model routing is controlled in `~/.pi/agent/settings.json` under `subagents`:

```jsonc
{
  "subagents": {
    "disableBuiltins": true,
    "modelOverridesEnabled": true,
    "agentOverrides": {
      "reviewer": { "model": "theclawbay-claude/claude-opus-4-8:high" },
      "worker": { "model": "theclawbay-claude/claude-sonnet-4-6:high" }
    },
    "savedAgentOverrides": {
      "reviewer": { "model": "theclawbay-claude/claude-opus-4-8:high" },
      "worker": { "model": "theclawbay-claude/claude-sonnet-4-6:high" }
    }
  }
}
```

- `modelOverridesEnabled: true` means `agentOverrides` is active.
- `modelOverridesEnabled: false` means `agentOverrides` is removed and `/models` controls every subagent.
- `savedAgentOverrides` preserves the per-role assignments while routing is disabled.
- `/subagents-models-set` validates selections against `~/.pi/agent/models.json`; `designer` must stay on a vision-capable model because its screenshot self-validation loop needs image input.

### Subagent Result Contract

Subagents return typed structured output, not free prose:

```jsonc
{ "status": "success | error | timeout | escalated",
  "summary": "...",
  "findings": [ { "priority": "P1", "summary": "...", "file": "...", "line": 42 } ],
  "artifacts": [ { "name": "...", "path": ".harness/...", "bytes": 1234 } ],
  "escalations": [ { "question": "...", "options": ["a","b"], "recommended": "a" } ] }
```

Large outputs are written to disk and returned as **artifact references** instead of being inlined, keeping the orchestrator's context lean.

### Context mode (fresh vs forked)

Fresh, isolated context (`--no-session`) is the default and the **only** mode for adversarial/read-only roles (`explore`, `plan`, `reviewer`, `oracle`, `researcher`, `evaluator`) — their value depends on being unbiased by the parent's prior reasoning. Continuity roles (`build`, `designer`) may opt into `forked` context, inheriting the parent session's history and prompt cache. See [ADR 0004](adr/0004-opt-in-forked-context-for-continuity-roles.md).

### Governed clarification

When a subagent genuinely needs input, it raises a typed question in its contract's `escalations[]` rather than opening a side-channel to the user. The parent (which owns all user communication) surfaces it via its own `ask` tool. This is structurally enforced: a child has neither the `task` nor `ask` tool.

### Writer worktrees and background execution

- **Worktree isolation** is granted to *any* writing agent (`build`, `designer`), not just `build` — their edits land in a throwaway git worktree under `.harness/worktrees/` and never touch the parent's working tree. Read-only roles get no worktree.
- **Background execution** (`background: true`) runs a subagent detached past the parent's turn. The `task` tool returns an immediate handle and the child writes its finished contract to `.harness/subagents/<id>.result.json` for the parent to poll. Foreground (blocking) execution remains the default. See [ADR 0005](adr/0005-background-subagent-result-via-file-polling.md).

## Thanos Lens Lite

Lens Lite is the lightweight replacement for always-on `pi-lens`. It is intentionally bounded and does **not** run project-wide scans in the background.

Always-on behavior:

- Tracks files read and changed during the session.
- Scans `write`/`edit` content for likely secrets, even when yolo is enabled.
- Blocks risky modifications of existing files that were not read first, forcing the model to read the file before retrying.
- Suppresses read-before-modify friction for normal exact `oldText` edits, files already changed this session, and new files.
- Updates a compact `lens:<changed>` status indicator.

Manual commands:

| Command | Description |
|---------|-------------|
| `/lens` | Show Lens Lite status and help |
| `/lens changed` | Show files edited this session |
| `/lens diagnose [file]` | Run bounded checks on changed files only (`git diff --check`, and configured Biome/ESLint/Ruff when available) |
| `/lens strict on` | Block all existing-file edits/writes without a prior read, including exact `oldText` edits |
| `/lens strict off` | Default low-noise mode: block only risky blind modifications |
| `/lens clear` | Clear Lens Lite session state |
| `/lens on` / `/lens off` | Toggle Lens Lite for the current session |

## Design notes

Architecture decisions are in [adr/](adr/). Implementation plans are in
[plans/](plans/). The project context and approved design direction are in
[CONTEXT.md](../CONTEXT.md).
