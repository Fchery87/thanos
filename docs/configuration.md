# Configuring Thanos

Thanos ships a **curated provider/model catalog** but **no maintainer API keys**. Every
provider and model is present out of the box — you only add your own keys.

The catalog is committed as `agent/models.example.json`. The installer copies it to
`agent/models.json` on first install (it never overwrites an existing one). After
install, add at least one provider credential, then use `/models` to select from
configured providers. Providers without a key or OAuth credential are hidden from
`/models` so the selector only offers models that can actually switch successfully.

```bash
thanos
# then use /login to add credentials and /models to select a configured model
```

## Adding keys

You can authenticate any of three ways (they coexist; `/login` always takes priority):

1. **`/login` (recommended).** Pick a provider, choose "Use an API key", paste your key.
   It is stored in `~/.pi/agent/auth.json` (gitignored). `/logout` removes it again.
   This works for every provider in the shipped catalog.
2. **Environment variables.** Each provider's `apiKey` field names an env var. Export it
   and Pi resolves it at runtime:

   ```bash
   export THECLAWBAY_API_KEY=...   # theclawbay + theclawbay-claude
   export CROFAI_API_KEY=...       # CrofAI
   ```
3. **Shell command.** Set a provider's `apiKey` to `"!your-secret-command"` in
   `~/.pi/agent/models.json` (e.g. `"!op read op://vault/key"`).

> Use the bare env-var name (`"THECLAWBAY_API_KEY"`), **not** `"$THECLAWBAY_API_KEY"` —
> Pi looks up the string verbatim in the environment.

MCP server keys go in `~/.pi/mcp.json` (created from `mcp.example.json` on install).
Optional secret overlays for MCP servers go in `mcp.json`'s companion
`mcp-secrets.json` (template: `mcp-secrets.example.json`; **not** auto-created, so
unconfigured servers never start with bogus credentials). Web search keys go in
`~/.pi/web-search.json` (created from `web-search.example.json`).

## Provider and model configuration

Add or edit providers in `~/.pi/agent/models.json`, supplying keys via `/login`, env
vars (bare name in the `apiKey` field), or a `!command`. See
[Adding keys](#adding-keys). `/models` shows only models from providers with
configured credentials — add a key first and the provider's models appear.

The user-owned copies are gitignored so credentials and local edits are never published:

```text
~/.pi/agent/models.json     # your catalog + any keys you inline
~/.pi/agent/auth.json       # /login credentials
~/.pi/agent/settings.json   # your local settings
~/.pi/mcp.json              # MCP server config + keys
~/.pi/mcp-secrets.json      # optional MCP secret overlay
~/.pi/web-search.json       # pi-web-access config + Exa key
```

The committed `*.example.json` templates carry no secrets, so the published repository
can never leak credentials.

## What's in here

```text
~/.pi/
├── agent/
│   ├── agents/                 # Specialist subagent definitions (explore, plan, build, reviewer, designer, oracle, researcher, evaluator)
│   ├── skills/                 # Your Pi skills (not bundled — gitignored, user-managed)
│   ├── models.example.json     # Curated provider/model catalog template (no keys)
│   ├── models.json             # User-owned catalog created by installer (gitignored)
│   ├── settings.example.json   # Thanos default Pi package/settings template
│   ├── settings.json           # User-owned local copy created by installer (gitignored)
│   ├── projects.example.json   # Captain delivery-mode registry template
│   ├── projects.json           # User-owned trusted registry: per-repo mode/autonomy/yolo (gitignored)
│   └── auth.json               # Credentials saved by /login (gitignored)
├── src/                        # Thanos Harness extension source
├── scripts/
│   ├── install.sh              # Linux/macOS installer (also used by `thanos update`)
│   ├── install.ps1             # Windows installer
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
| `npm:pi-lens` | ❌ Removed (not installed). It caused 11–52s startup/edit latency from LSP, lint, `knip`, `jscpd`, and cascade-diagnostic hooks. Replaced by Thanos Lens Lite for low-cost safety and manual diagnostics. |

### Rytswd extensions (active)

| Extension | Status |
|-----------|--------|
| `fetch/*` | ✅ Active |
| `notify/*` | ✅ Active |
| `permission-gate/*` | ✅ Active |
| `questionnaire/*` | ✅ Active |
| `slow-mode/*` | ✅ Active |
| `statusline/*` | ⚪ Available, disabled by default (shipped default status bar is `npm:@npm-ken/pi-bar`; see [Status bar](#status-bar)) |
| `direnv/*` | ❌ Excluded (binary not installed) |
| `stash/*` | ❌ Excluded (redundant with pi-web-access) |

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

Web search is provided by the `pi-web-access` package (Exa), not an MCP server — the
redundant `exa` MCP server was removed.

Copy `mcp.example.json` to `mcp.json` and fill in your API keys.

## Status bar

> The shipped default status bar is `npm:@npm-ken/pi-bar`; the rytswd `statusline/*`
> extension is disabled in `settings.example.json`. To use the rytswd statusline
> instead, enable `statusline/*` and remove `npm:@npm-ken/pi-bar` in
> `~/.pi/agent/settings.json`. The segments below describe the rytswd statusline layout.

The rytswd statusline shows a single condensed line below the editor:

```text
glm-5.1 ❯ D:45% ❯ 42%/200k ❯ think:med ❯ ↑15.2k ↓3.1k ❯ Alora ❯ main +2 ~1 ❯ $0.12
```

Segments: model · subscription usage · context · thinking · tokens · path · vcs · cost · extension statuses

A custom `segTokens` segment shows per-turn input (↑) and output (↓) token counts.
Thanos Lens Lite also exposes a compact `lens:<changed>` status indicator. When a todo
list is active, a `todo:<done>/<total>` segment reflects checklist progress for the
current branch (it reconstructs from the session branch, so it survives reload and is
correct after a branch/fork). While a
[`/goal`](guide.md#goal--self-checking-autonomous-loop) is active, a
`◎ goal:<turns>t·<growth>k` segment shows the turn count and cumulative context growth
(`◎ goal:paused` when paused).
