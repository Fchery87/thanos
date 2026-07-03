# Thanos

Personal [Pi coding agent](https://earendil.works) configuration — includes the **Thanos Harness** governance extension plus a curated set of npm packages, MCP servers, and skills.

> **Pi version:** 0.80.2+ · **Theme:** Brogrammer · **Provider/model:** user-configured

---

## Install

Thanos is distributed directly from GitHub. No npm package setup is required.

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.sh | sh
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.ps1 | iex
```

Then open a new terminal and run:

```bash
thanos
```

Update anytime with:

```bash
thanos update
```

### Install a pinned tag or branch

```bash
curl -fsSL https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.sh | sh -s -- --ref v0.1.0
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.ps1))) -Ref v0.1.0
```

### Existing Pi users

The default install location is `~/.pi` because Pi reads user packages and settings from there. If `~/.pi` already exists and is not the Thanos repo, the installer stops instead of overwriting it. To intentionally back it up and install Thanos, pass `--force` on Linux/macOS or `-Force` on Windows.

### Requirements

- Git
- Node.js 24+ with npm, or Bun 1.3+
- curl/wget on Linux/macOS, or PowerShell on Windows
- Optional: `xclip` for Linux clipboard support
- Optional: `ffmpeg` + `yt-dlp` for video frame extraction

---

## User API keys and provider setup

Thanos ships a **curated provider/model catalog** but **no maintainer API keys**. Every provider
and model is present out of the box — you only add your own keys.

The catalog is committed as `agent/models.example.json`. The installer copies it to
`agent/models.json` on first install (it never overwrites an existing one). After install, add at
least one provider credential, then use `/models` to select from configured providers. Providers
without a key or OAuth credential are hidden from `/models` so the selector only offers models that
can actually switch successfully.

```bash
thanos
# then use /login to add credentials and /models to select a configured model
```

### Adding keys

You can authenticate any of three ways (they coexist; `/login` always takes priority):

1. **`/login` (recommended).** Pick a provider, choose "Use an API key", paste your key. It is
   stored in `~/.pi/agent/auth.json` (gitignored). `/logout` removes it again. This works for
   every provider in the shipped catalog.
2. **Environment variables.** Each provider's `apiKey` field names an env var. Export it and Pi
   resolves it at runtime:

   ```bash
   export THECLAWBAY_API_KEY=...   # theclawbay + theclawbay-claude
   export CROFAI_API_KEY=...       # CrofAI
   ```
3. **Shell command.** Set a provider's `apiKey` to `"!your-secret-command"` in
   `~/.pi/agent/models.json` (e.g. `"!op read op://vault/key"`).

> Use the bare env-var name (`"THECLAWBAY_API_KEY"`), **not** `"$THECLAWBAY_API_KEY"` — Pi looks
> up the string verbatim in the environment.

MCP server keys go in `~/.pi/mcp.json` (created from `mcp.example.json` on install). Optional
secret overlays for MCP servers go in `~/.pi/mcp.json`'s companion `mcp-secrets.json` (template:
`mcp-secrets.example.json`; **not** auto-created, so unconfigured servers never start with bogus
credentials). Web search keys go in `~/.pi/web-search.json` (created from `web-search.example.json`).

---

## Using Thanos — step by step

This walkthrough takes you from a fresh install to a governed, productive session. Each step is independent — skip ahead if you already have it set up.

### Step 1 — Install and launch

```bash
curl -fsSL https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.sh | sh
thanos
```

The first launch creates your user-owned config files (`models.json`, `settings.json`, `mcp.json`, …) from the committed `*.example.json` templates. Nothing is overwritten if it already exists.

### Step 2 — Add a provider key and pick a model

No API keys ship with Thanos — you bring your own.

```text
/login        # pick a provider → "Use an API key" → paste; stored in agent/auth.json
/models       # choose the active model from configured providers
```

Providers without credentials do not appear in `/models`. Add a key with `/login`, an environment
variable, or a shell-command credential first; see [Adding keys](#adding-keys) for the alternatives.

### Step 3 — Understand the permission model (important)

Thanos is **secure by default**. Yolo mode is **off**, so the harness asks before it edits a file or runs a shell command. You will see a permission prompt for each `edit`/`write` (high risk) and each `bash` call (critical risk). This is intentional — it's what keeps an agent from acting without your sign-off.

You have three ways to reduce prompting, in increasing order of trust:

1. **Approve per action** — answer each prompt as it comes. Maximum control.
2. **Mark a repo `unattended`** in your captain registry (Step 4) — auto-approves actions *within* that repo's policy ceiling, so no prompts for allowed work. Pair it with `mode: "direct-PR"` if you also want commit **and** push with no prompts; `local-only` keeps the same no-prompt feel but blocks push. Deny rules always still block.
3. **Yolo** (`/yolo` or `Ctrl+Shift+Y`) — bypasses the whole permission layer for the session. The Lens Lite secret scan still runs. You can hard-disable yolo entirely (see [Yolo lockout](#yolo-lockout)).

> Prefer option 2 over option 3. `unattended` gives you the same prompt-free experience while keeping the policy ceiling and secret protections intact; yolo removes everything.

### Step 4 — Register your projects (delivery modes)

Tell Thanos how far each repo's work may travel and how autonomously it may act there. This is the file that makes coding frictionless: list the repos you trust as `unattended` so they stop prompting, and pick a `mode` that allows what you need (e.g. pushing).

```bash
cp ~/.pi/agent/projects.example.json ~/.pi/agent/projects.json
# then edit ~/.pi/agent/projects.json
```

**Recommended frictionless setup — code, commit, *and* push with no approval prompts:**

```jsonc
{
  "version": 1,
  "default": { "mode": "local-only", "autonomy": "unattended" }, // no prompts anywhere; push only on listed repos
  "projects": [
    {
      "match": "https://github.com/you/your-repo.git", // matched against `git remote get-url origin`
      "path": "/home/you/code/your-repo",              // fallback match when there's no remote
      "mode": "direct-PR",                              // allows commit AND push (local-only would block push)
      "autonomy": "unattended"                          // auto-approve all allowed actions — zero prompts
    }
  ]
}
```

The `mode` is what gates pushing, and `autonomy` is what gates prompting:

- `mode: "direct-PR"` (or `no-mistakes`) → `git push` / PRs are allowed. `mode: "local-only"` → push is denied.
- `autonomy: "unattended"` → no approval prompts for anything the mode allows. `autonomy: "attended"` → prompts as usual.

So `direct-PR` + `unattended` = the frictionless "just let me work" experience, while still keeping the free guardrails (Pi can't read your `.env`/keys, and the secret-scan blocks committing a leaked key). For maximum security on a sensitive repo, use `local-only` + `attended` instead; to hard-disable yolo, add top-level `"yolo": "disabled"`.

This file is **gitignored and trusted** — only you edit it, and a repo can never grant itself more autonomy (see [Trust-split](#trust-split)). The full reference is in [Delivery modes](#delivery-modes).

### Step 5 — Do the work, delegating to subagents

Drive the session in natural language. For bounded, parallelizable, or adversarial work, delegate to a **specialist subagent** instead of doing it inline:

```text
/modes              # choose the default specialist for the `task` tool
/designer <goal>    # spawn the Designer for UI/UX work
Ctrl+Shift+R        # spawn a Reviewer for a structured P0–P3 review
Ctrl+Shift+D        # spawn the Designer
```

Subagents run under your policy as a ceiling, return a typed result contract, and nest at most one level deeper (capped). Driving from the main session and letting it orchestrate specialists is the recommended pattern — see [Main-agent-as-orchestrator workflow](#main-agent-as-orchestrator-workflow) and [Governed subagents](#governed-subagents).

#### Optional per-subagent model routing

By default, Thanos can route each specialist role to its own model from your active `~/.pi/agent/models.json` catalog. This is the "reasoning sandwich": deep reasoning roles such as `oracle`, `plan`, and reviewers can use stronger/high-thinking models, while mechanical roles can use faster or cheaper models.

Use the visible slash commands:

```text
/subagents-models          # show current routing and usage
/subagents-models-set      # pick a role, then pick one of your active models
/subagents-models-set reviewer
/subagents-models-toggle   # pick on/off
/subagents-models-toggle on
/subagents-models-toggle off
```

When routing is **on**, `subagents.agentOverrides` is active and each assigned role uses its configured model. When routing is **off**, Thanos saves the assignments under `subagents.savedAgentOverrides` and removes active `agentOverrides`, so the model selected with `/models` controls all subagents as it did before per-role routing existed. Editing routes while disabled updates the saved assignments without activating them.

Long provider/model references are shortened in the picker so the terminal UI stays stable while scrolling, but Thanos still saves the full model reference in `settings.json`.

### Step 6 — Track and verify

```text
/todo               # phased checklist for the current branch (survives reload)
/spec               # acceptance criteria derived from your prompt + verification state
/lens diagnose      # bounded lint/diff checks on changed files only
/policy             # show the active governance policy ceiling
/audit              # review what was allowed/denied this session
```

#### Completion verification gate

For non-instant implementation tasks, Thanos treats the active spec as the definition of done. When the agent tries to stop while acceptance criteria are still missing evidence, the harness sends a bounded follow-up turn with the unmet criteria instead of letting the model self-certify completion. The loop is parent-session only, keeps the original spec active across continuation turns, and stops after three reinjections.

Evidence comes from the normal harness channels: diffs, passing test or command output, and explicit manual evidence. If you need to debug the harness itself or temporarily bypass this loop, start Thanos with:

```bash
THANOS_VERIFY_GATE=off thanos
```

This disables only the completion verification reinjection gate. It does not disable policy, yolo lockout, Lens Lite, or delivery-mode restrictions.

#### `/goal` — self-checking autonomous loop

`/goal <condition>` turns a prompt into a durable objective. Thanos immediately starts a turn toward the condition, and after **each** turn a fresh, tool-less **side-channel evaluator** (a one-shot `completeSimple` call, not a subagent — so no extra agent turn and no re-entrancy) reads the last turn's evidence and returns `MET` / `NOT_MET`. `NOT_MET` auto-continues another turn with the reason as guidance; `MET` clears the goal and records the achievement. Unparseable evaluator output is treated as `NOT_MET` (fail-safe: it never declares a false "done").

```text
/goal <condition>   # set a goal and start working toward it
/goal               # status (condition, turns, context growth, last check)
/goal pause         # stop auto-continuing (resumable)
/goal resume        # resume a paused goal
/goal clear         # cancel (aliases: stop off reset none cancel)
```

The loop is **guarded**: it pauses (never clears) on a turn ceiling (`maxTurns`, default 25), an optional context-growth ceiling (`maxTokens`), or an optional `checkpointEvery`. A statusline segment shows `◎ goal:<turns>t·<growth>k` while active. It is main-session only and refuses on untrusted projects. Permission prompts are orthogonal — a tool needing approval pauses the loop until you answer.

`/goal` and the completion verification gate never fight: while a goal is active, the goal evaluator is the **sole** continuation driver (the gate defers), so at most one follow-up is queued per turn. Configure defaults under `goal` in `~/.pi/agent/settings.json`:

```jsonc
"goal": {
  "maxTurns": 25,        // pause on hit (0 = unlimited / full-auto)
  "maxTokens": 0,        // cumulative context-growth ceiling, NOT a spend cap; 0 = off
  "checkpointEvery": 0,  // 0 = off; N = pause-to-confirm every N turns
  "evaluatorRole": "evaluator"
}
```

> `maxTokens` is a context-**growth** guard, not a spend meter: it accumulates clamped per-turn context growth (compaction can never make it go backwards). `maxTurns` remains the real budget.

### Step 7 — Ship it

When your gates are green, deliver the branch per its resolved mode:

```text
/ship
```

- **local-only** → a fast-forward-only merge of the current branch into your local default branch. It **never pushes**; if the branches diverged, it reports the failure rather than force-merging.
- **direct-PR / no-mistakes** → informational in v1: confirm gates, then push / open the PR yourself.

See [/ship](#ship) for details.

---

## What's in here

```
~/.pi/
├── agent/
│   ├── agents/                 # Specialist subagent definitions (explore, plan, build, reviewer, designer, oracle, researcher, evaluator)
│   ├── skills/                 # Installed Pi skills
│   ├── models.example.json     # Curated provider/model catalog template (no keys)
│   ├── models.json             # User-owned catalog created by installer (gitignored)
│   ├── settings.example.json   # Thanos default Pi package/settings template
│   ├── settings.json           # User-owned local copy created by installer (gitignored)
│   ├── projects.example.json   # Captain delivery-mode registry template
│   ├── projects.json           # User-owned trusted registry: per-repo mode/autonomy/yolo (gitignored)
│   └── auth.json               # Credentials saved by /login (gitignored)
├── src/                        # Thanos Harness extension source
├── scripts/
│   └── sync-models-dev.mjs     # Sync model metadata from models.dev
├── docs/
│   ├── adr/                    # Architecture Decision Records
│   └── plans/                  # Implementation planning documents
├── CONTEXT.md                  # Design glossary and approved direction
├── mcp.example.json            # MCP server config template
├── mcp.json                    # User-owned MCP server config (gitignored)
├── mcp-secrets.example.json    # Optional MCP secret-overlay template
├── web-search.example.json     # pi-web-access config template
├── web-search.json             # User-owned pi-web-access config (gitignored)
└── .gitignore
```

---

## Installed packages

### Extensions

| Package | Purpose |
|---------|---------|
| **Thanos Harness** (`src/`) | Governance, permissions, spec lifecycle, audit logging, policy, and Lens Lite |
| `rytswd/pi-agent-extensions` | Statusline, fetch, notify, permission-gate, questionnaire, slow-mode |
| `npm:pi-subagents` | 8 built-in agents, `/run`, `/chain`, `/parallel` commands |
| `npm:pi-web-access` | Web search (Exa), URL fetch, YouTube transcripts, GitHub cloning |
| `npm:context-mode` | Context window management and search |
| `npm:@victor-software-house/pi-curated-themes` | Brogrammer and other themes |

### Disabled packages

| Package | Status |
|---------|--------|
| `npm:pi-lens` | ❌ Disabled from always-on runtime. It caused 11–52s startup/edit latency from LSP, lint, `knip`, `jscpd`, and cascade-diagnostic hooks. Replaced by Thanos Lens Lite for low-cost safety and manual diagnostics. |

### Rytswd extensions (active)

| Extension | Status |
|-----------|--------|
| `fetch/*` | ✅ Active |
| `notify/*` | ✅ Active |
| `permission-gate/*` | ✅ Active |
| `questionnaire/*` | ✅ Active |
| `slow-mode/*` | ✅ Active |
| `statusline/*` | ✅ Active (with custom token count segment) |
| `direnv/*` | ❌ Excluded (binary not installed) |
| `stash/*` | ❌ Excluded (redundant with pi-web-access) |

---

## Thanos tools

| Tool | Purpose |
|------|---------|
| `task` | Delegate to a bounded specialist subagent under the current policy ceiling (see [Governed subagents](#governed-subagents)) |
| `todo` | Track phased tasks with in-progress state and export/import |
| `ask` | Governed option-based question → decision record |
| `report_finding` | Record structured P0–P3 review findings |

---

## Governed subagents

The `task` tool delegates work to a bounded **specialist subagent** — a separate `pi` subprocess spawned in JSON mode under the parent's policy as a ceiling. Subagents are a deliberate governance surface, not just parallelism:

- **Bounded nesting (depth ≤ 2).** The legacy `task` tool is suppressed inside subagents (`HARNESS_SUBAGENT` set), so that path is depth-1. The live pi-subagents `subagent` tool permits **one** further level — capped by `maxSubagentDepth` (engine default 2) — so a specialist can delegate a capability it deliberately lacks (e.g. the exec-denied `designer` delegating a render + screenshot to `build` for self-validation). A depth-2 child cannot spawn further, and subagents never talk to the user directly. Deeper nesting stays a recognized anti-pattern.
- **Policy ceiling inheritance.** Each subagent's capabilities are narrowed from the parent policy; read-only roles get hard `edit`/`exec` denies regardless of what the parent allows.

### Main-agent-as-orchestrator workflow

The recommended way to do non-trivial work: **drive the main session in natural language and let it orchestrate specialists**, rather than doing everything inline. The main agent (depth 0) holds the goal and context, dispatches bounded specialists for the parts they do best, and synthesizes their typed results. A goal with distinct phases (design → build → verify → critique) maps cleanly onto this.

Orchestration works at two altitudes that compose:

1. **Main agent → specialist (depth 0 → 1).** The default: call `designer`, `build`, `reviewer`, `oracle`, etc.
2. **Specialist → sub-specialist (depth 1 → 2).** A specialist delegates one level down to gain a capability it deliberately lacks — canonically, the exec-denied `designer` delegating a render + screenshot to `build` for its self-validation loop. You don't orchestrate this; it happens inside the specialist's run, capped at depth 2.

Both altitudes were validated live (2026-06-27) on a non-Anthropic model, so the pattern is model-agnostic. To exercise a specialist's *own* loop instead of having the main agent do the work for it, dispatch it verbatim: "invoke `<agent>` once and return its raw contract; do not orchestrate, build, screenshot, or critique yourself." Full guide: [docs/main-agent-orchestrator-workflow.md](docs/main-agent-orchestrator-workflow.md).

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

Fresh, isolated context (`--no-session`) is the default and the **only** mode for adversarial/read-only roles (`explore`, `plan`, `reviewer`, `oracle`, `researcher`, `evaluator`) — their value depends on being unbiased by the parent's prior reasoning. Continuity roles (`build`, `designer`) may opt into `forked` context, inheriting the parent session's history and prompt cache. See [ADR 0004](docs/adr/0004-opt-in-forked-context-for-continuity-roles.md).

### Governed clarification

When a subagent genuinely needs input, it raises a typed question in its contract's `escalations[]` rather than opening a side-channel to the user. The parent (which owns all user communication) surfaces it via its own `ask` tool. This is structurally enforced: a child has neither the `task` nor `ask` tool.

### Writer worktrees and background execution

- **Worktree isolation** is granted to *any* writing agent (`build`, `designer`), not just `build` — their edits land in a throwaway git worktree under `.harness/worktrees/` and never touch the parent's working tree. Read-only roles get no worktree.
- **Background execution** (`background: true`) runs a subagent detached past the parent's turn. The `task` tool returns an immediate handle and the child writes its finished contract to `.harness/subagents/<id>.result.json` for the parent to poll. Foreground (blocking) execution remains the default. See [ADR 0005](docs/adr/0005-background-subagent-result-via-file-polling.md).

---

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

---

## Thanos slash commands

| Command | Description |
|---------|-------------|
| `/models` | Two-step provider → model selector for providers with configured credentials; includes reasoning/image badges |
| `/subagents-models` | Show per-subagent model routing, saved assignments, and usage |
| `/subagents-models-set [role]` | Select a role, then choose one of your active catalog models for that subagent |
| `/subagents-models-toggle [on\|off]` | Enable per-subagent routing or disable it so `/models` controls all subagents |
| `/designer [goal]` | Spawn the Designer subagent for UI/UX implementation, review, or design-system audit |
| `/run designer <task>` | Run Designer through `pi-subagents` directly; also appears in `/run` completions after reload |
| `/lens` | Thanos Lens Lite: changed files, read-before-modify guard, secret scan, manual diagnostics |
| `/goal [condition\|pause\|resume\|clear]` | Set a self-checking goal; the agent auto-continues until a fresh evaluator confirms it. No arg shows status. Main session only; pauses on ceilings. See [`/goal`](#goal--self-checking-autonomous-loop) |
| `/todo` | Show the current todo checklist for this branch (Escape to close); `/todo export` prints the markdown |
| `/modes` | Select the default specialist mode used by `task` when `type` is omitted (`explore`, `plan`, `build`, `reviewer`, `designer`, `oracle`, `researcher`, `evaluator`) |
| `/yolo` | Toggle yolo mode for this session (bypasses thanos permission checks; Lens Lite secret scan still runs). Refuses when yolo is locked by config — see [Yolo lockout](#yolo-lockout) |
| `/ship` | Deliver the current branch per the resolved [delivery mode](#delivery-modes) (local-only: fast-forward merge into the default branch; main session only) |
| `/remember` | Save a durable project preference, injected into future sessions on this branch/project |
| `/memory` | List remembered project preferences; `/memory forget <n>` removes one |
| `/mcp` | Manage MCP server connections |
| `/thinking` | Select thinking level |
| `/skills` | List available skills |
| `/context` | Show context window usage |
| `/policy` | Show active governance policy |
| `/tools` | List registered tools |
| `/spec` | Manage spec lifecycle |
| `/audit` | Show audit log |
| `/rename` | Rename the current session |
| `/status` | Show session status |
| `/worktree` | Manage git worktrees |

Slash command panels and interactive pickers are rendered with terminal-safe widths. Long paths,
provider names, MCP server names, model references, policy rules, and diagnostics are shortened in
the visible UI instead of wrapping across the terminal; underlying command behavior still uses the
full original values.

---

## Keyboard shortcuts

All shortcuts use `Ctrl+Shift+<key>` for cross-platform consistency. On macOS, press Control (not ⌘ Command) + Shift + key.

| Shortcut | Action | Mnemonic |
|----------|--------|----------|
| `Ctrl+Shift+K` | Select thinking level | **K** = thin**k**ing |
| `Ctrl+Shift+F` | Show session snapshot (model, spec, policy, context) | **F** = full status |
| `Ctrl+Shift+E` | Show active spec and verification state | **E** = **e**xpand spec |
| `Ctrl+Shift+G` | Show active policy rules | **G** = **g**overnance |
| `Ctrl+Shift+A` | Show last 10 audit log entries | **A** = **a**udit |
| `Ctrl+Shift+R` | Run code review (spawns reviewer subagent) | **R** = **r**eview |
| `Ctrl+Shift+D` | Spawn designer agent | **D** = **d**esigner |
| `Ctrl+Shift+Y` | Toggle yolo mode | **Y** = **y**olo |

### pi-web-access shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Review search results (curator) |
| `Ctrl+Shift+N` | Toggle web search activity widget |

---

## Status bar

> The shipped default status bar is `npm:@npm-ken/pi-bar`; the rytswd `statusline/*` extension is
> disabled in `settings.example.json`. To use the rytswd statusline instead, enable `statusline/*`
> and remove `npm:@npm-ken/pi-bar` in `~/.pi/agent/settings.json`. The segments below describe the
> rytswd statusline layout.

The rytswd statusline shows a single condensed line below the editor:

```
glm-5.1 ❯ D:45% ❯ 42%/200k ❯ think:med ❯ ↑15.2k ↓3.1k ❯ Alora ❯ main +2 ~1 ❯ $0.12
```

Segments: model · subscription usage · context · thinking · tokens · path · vcs · cost · extension statuses

A custom `segTokens` segment shows per-turn input (↑) and output (↓) token counts. Thanos Lens Lite also exposes a compact `lens:<changed>` status indicator. When a todo list is active, a `todo:<done>/<total>` segment reflects checklist progress for the current branch (it reconstructs from the session branch, so it survives reload and is correct after a branch/fork).

---

## MCP servers

| Server | Type | Purpose |
|--------|------|---------|
| chrome-devtools | stdio | Browser DevTools integration |
| context7 | stdio | Context-aware documentation lookup |
| sequential-thinking | stdio | Step-by-step reasoning |
| convex-mcp | stdio | Convex database integration |
| mgrep | stdio | Fast ripgrep-based code search |
| neon | SSE | Neon Postgres integration |
| stitch | SSE | Google Stitch design tools |

Web search is provided by the `pi-web-access` package (Exa), not an MCP server — the redundant `exa` MCP server was removed.

Copy `mcp.example.json` to `mcp.json` and fill in your API keys.

---

## Governance

### Permission gate

Every tool call is classified by risk tier and a capability:

| Tool | Risk | Capability |
|------|------|-----------|
| `read`, `ls`, `find`, `grep` | low | `read` |
| `write`, `edit` | high | `edit` |
| `bash` | critical | `exec` |
| `ask`, `todo`, `report_finding` | medium | `interaction` |

Each call is evaluated against the active policy ceiling (preset + any delivery overlay). The order of checks is: **yolo (if on) → policy/permission deny → autonomy → interactive prompt.** Deny always wins; autonomy can only auto-approve what the ceiling already allows.

Yolo mode is **default off** — the harness asks before high/critical actions. When yolo *is* turned on for a session it short-circuits to "allow" immediately (the Lens Lite secret scan still runs), letting rytswd `permission-gate` and `slow-mode` run independently. Yolo can be hard-disabled so it cannot be turned on at all — see [Yolo lockout](#yolo-lockout). To make a yolo-off setup frictionless on trusted repos, mark them `unattended` in the [captain registry](#delivery-modes).

### Context-mode execution guard

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

### Spec lifecycle

Thanos derives acceptance criteria from your prompt and verifies them after each run. Use `--spec` to require explicit approval before the first write.

### Policy

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

---

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

A starter registry ships as [`agent/projects.example.json`](agent/projects.example.json). Copy it to `~/.pi/agent/projects.json` and edit:

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

---

## Provider and model configuration

Thanos ships the provider/model catalog but leaves credentials to each user. The catalog template
`agent/models.example.json` is committed; the installer copies it to `agent/models.json` on first
run. `/models` lists every model in it, even before credentials are configured.

Add or edit providers in `~/.pi/agent/models.json`, supplying keys via `/login`, env vars (bare
name in the `apiKey` field), or a `!command`. See [Adding keys](#adding-keys).

The user-owned copies are gitignored so credentials and local edits are never published:

```text
~/.pi/agent/models.json     # your catalog + any keys you inline
~/.pi/agent/auth.json       # /login credentials
~/.pi/agent/settings.json   # your local settings
~/.pi/mcp.json              # MCP server config + keys
~/.pi/mcp-secrets.json      # optional MCP secret overlay
~/.pi/web-search.json       # pi-web-access config + Exa key
```

The committed `*.example.json` templates carry no secrets, so the published repo and release
tarballs (built via `git archive`, which exports tracked files only) can never leak credentials.

---

## Prerequisites

- [Pi coding agent](https://earendil.works) v0.80.2+
- Node.js v24+ or [Bun](https://bun.sh) v1.3+
- `xclip` (for clipboard support with pi-web-access)
- `ffmpeg` + `yt-dlp` (optional, for video frame extraction)

---

## Design notes

Architecture decisions are in [docs/adr/](docs/adr/). Implementation plans are in [docs/plans/](docs/plans/). The project context and approved design direction are in [CONTEXT.md](CONTEXT.md).
