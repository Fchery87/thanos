# Thanos

Personal [Pi coding agent](https://earendil.works) configuration — includes the **Thanos Harness** governance extension plus a curated set of npm packages, MCP servers, and skills.

> **Pi version:** 0.75.3+ · **Theme:** Brogrammer · **Default provider/model:** `theclawbay/gpt-5.5`

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

## User API keys

Thanos does **not** ship maintainer API keys. Each user must provide their own provider and MCP keys.

The bundled default provider uses these environment variables:

```bash
export THECLAWBAY_API_KEY="your-key"
export CROFAI_API_KEY="your-key"
```

Windows PowerShell:

```powershell
setx THECLAWBAY_API_KEY "your-key"
setx CROFAI_API_KEY "your-key"
```

Users can also switch to another Pi provider/model with `/settings`, `/models`, or by editing `~/.pi/agent/settings.json`. MCP server keys go in `~/.pi/mcp.json`, which is created from `mcp.example.json` during install.

---

## What's in here

```
~/.pi/
├── agent/
│   ├── agents/                 # Custom agent definitions (designer.md)
│   ├── skills/                 # Installed Pi skills (86+)
│   ├── models.json             # Custom providers that reference user-owned env vars
│   └── settings.json           # Pi agent settings and package list
├── src/                        # Thanos Harness extension source
├── scripts/
│   └── sync-models-dev.mjs     # Sync model metadata from models.dev
├── docs/
│   ├── adr/                    # Architecture Decision Records
│   └── plans/                  # Implementation planning documents
├── CONTEXT.md                  # Design glossary and approved direction
├── mcp.json                    # User-owned MCP server config (gitignored)
├── mcp.example.json            # MCP server config template
├── web-search.json             # Optional user-owned pi-web-access config (gitignored)
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
| `todo` | Track phased tasks with in-progress state and export/import |
| `ask` | Governed option-based question → decision record |
| `report_finding` | Record structured P0–P3 review findings |

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
| `/models` | Two-step provider → model selector with reasoning/image badges |
| `/designer [goal]` | Spawn the Designer subagent for UI/UX implementation, review, or design-system audit |
| `/run designer <task>` | Run Designer through `pi-subagents` directly; also appears in `/run` completions after reload |
| `/lens` | Thanos Lens Lite: changed files, read-before-modify guard, secret scan, manual diagnostics |
| `/modes` | Select default legacy specialist mode (`explore`, `plan`, `build`, `reviewer`, `designer`) |
| `/yolo` | Toggle yolo mode (bypasses thanos permission checks; Lens Lite secret scan still runs) |
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

The rytswd statusline shows a single condensed line below the editor:

```
glm-5.1 ❯ D:45% ❯ 42%/200k ❯ think:med ❯ ↑15.2k ↓3.1k ❯ Alora ❯ main +2 ~1 ❯ $0.12
```

Segments: model · subscription usage · context · thinking · tokens · path · vcs · cost · extension statuses

A custom `segTokens` segment shows per-turn input (↑) and output (↓) token counts. Thanos Lens Lite also exposes a compact `lens:<changed>` status indicator.

---

## MCP servers

| Server | Type | Purpose |
|--------|------|---------|
| chrome-devtools | stdio | Browser DevTools integration |
| context7 | stdio | Context-aware documentation lookup |
| sequential-thinking | stdio | Step-by-step reasoning |
| convex-mcp | stdio | Convex database integration |
| mgrep | stdio | Fast ripgrep-based code search |
| neon | SSE | Neon Postgres (disabled) |
| stitch | SSE | Google Stitch design tools (disabled) |
| exa | stdio | Web search (disabled — replaced by pi-web-access) |

Copy `mcp.example.json` to `mcp.json` and fill in your API keys.

---

## Governance

### Permission gate

Every tool call is classified by risk tier:

| Tool | Risk | Capability |
|------|------|-----------|
| `read`, `ls`, `find`, `grep` | low | `read` |
| `write`, `edit` | high | `edit` |
| `bash` | critical | `exec` |
| `ask`, `todo`, `report_finding` | medium | `interaction` |

Yolo mode is **default on** — the thanos governance layer returns "allow" immediately, letting rytswd `permission-gate` and `slow-mode` run independently.

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

## Custom providers

Two custom providers in `agent/models.json`:

| Provider | API type | Models |
|----------|----------|--------|
| CrofAI | openai-completions | 17 models |
| theclawbay | openai-responses | 17 models |

26 additional pi-supported providers configured in `agent/auth.json` via environment-variable references.

Model metadata synced from `models.dev` via `scripts/sync-models-dev.mjs`:

```bash
node scripts/sync-models-dev.mjs           # dry-run
node scripts/sync-models-dev.mjs --write   # apply changes
```

---

## Prerequisites

- [Pi coding agent](https://earendil.works) v0.75.3+
- Node.js v24+ or [Bun](https://bun.sh) v1.3+
- `xclip` (for clipboard support with pi-web-access)
- `ffmpeg` + `yt-dlp` (optional, for video frame extraction)

---

## Design notes

Architecture decisions are in [docs/adr/](docs/adr/). Implementation plans are in [docs/plans/](docs/plans/). The project context and approved design direction are in [CONTEXT.md](CONTEXT.md).
