# Thanos

Personal [Pi coding agent](https://earendil.works) configuration — includes the **Thanos Harness** governance extension that adds capability-based permissions, spec lifecycle management, and specialist subagent delegation to every Pi session.

---

## Install

### One-liner (recommended)

```bash
npx thanos-install
```

Installs Pi (if missing), downloads the latest stable Thanos release, verifies the release tarball against published SHA256 checksums, installs the harness extension into `~/.pi`, and adds the `thanos` command to your PATH.

### Pinned install

```bash
THANOS_VERSION=v0.1.0 npx thanos-install
```

Use this form when you want a reproducible install from a specific release.

### Manual clone

```bash
git clone https://github.com/fchery87/thanos.git ~/.pi
~/.pi/scripts/install.sh --skip-clone
```

After any install method, open a new terminal and run:

```bash
thanos
```

Run `thanos update` anytime to pull the latest stable config, or set `THANOS_VERSION=vX.Y.Z` to pin the update.

---

## What's in here

```
.pi/
├── agent/
│   ├── skills/                 # Installed Pi skills
│   ├── models.json             # Provider and model configuration
│   └── settings.json           # Pi agent settings
├── src/                        # Thanos Harness extension source
├── tests/                      # Harness test suite
├── docs/
│   ├── adr/                    # Architecture Decision Records
│   └── plans/                  # Implementation planning documents
├── scripts/
│   ├── install.sh              # POSIX installer
│   ├── install.ps1             # Windows installer
│   └── npm-install.mjs         # npx entry point
├── CONTEXT.md                  # Thanos design glossary and approved direction
├── mcp.example.json            # MCP server config template — copy to mcp.json and add your keys
└── .gitignore
```

---

## Prerequisites

- [Pi coding agent](https://earendil.works) v0.74.0+ (installed automatically by `install.sh`)
- Node.js v24+ or [Bun](https://bun.sh) v1.3+

---

## Thanos Harness

The Harness extension (`src/`) adds three layers to every Pi session:

### Permission gate

Every tool call is classified by risk tier before it runs:

| Tool | Risk | Capability |
|------|------|-----------|
| `read`, `ls`, `find`, `grep` | low | `read` |
| `write`, `edit` | high | `edit` |
| `bash` | critical | `exec` |
| `task` | medium | `task` |
| `ask`, `todo`, `report_finding` | medium | `interaction` |

Edit and exec tools require confirmation by default. Sensitive file paths (credentials, secrets) are denied before any generic read allowance kicks in.

### Spec lifecycle

Thanos automatically derives acceptance criteria from your prompt and verifies them after each run. Use `--spec` to require explicit approval before the first write:

```bash
thanos --spec
```

### Subagent delegation

The `task` tool lets Thanos hand off focused work to specialists:

| Type | Tools available | Use for |
|------|----------------|---------|
| `explore` | read, ls, find, grep | Investigating the codebase |
| `plan` | read, ls, find, grep | Producing implementation plans |
| `build` | read, write, edit, bash | Implementing changes |
| `reviewer` | read + can spawn explore | Code review |
| `designer` | read + write | UI/UX work |

### Governed interaction primitives

Thanos also ships governed interaction tools for structured human decisions and review flow:

| Tool | Purpose |
|------|---------|
| `ask` | Ask one typed, option-based question and return a governed decision record |
| `todo` | Track phased task state with explicit export/import |
| `report_finding` | Record reviewer findings as structured P0-P3 evidence |
### MCP management

Use `/mcp` within Thanos to manage server connections:

```
/mcp list                   # show all servers and status
/mcp enable <name>          # connect a disabled server
/mcp disable <name>         # disconnect and mark disabled
/mcp auth <name>            # set or update credentials
/mcp reload                 # reload all servers from config
```

---

## Policy

Governance rules live in `harness.policy.json`, or in the file pointed to by `HARNESS_POLICY_FILE`.
The current configuration uses the `team` preset with audit logging enabled and headless mode set to `deny`.
Team and ci presets include built-in sensitive-read deny rules. If the policy file is malformed, Thanos fails closed instead of silently reverting to personal defaults.

```json
{
  "version": 1,
  "preset": "team",
  "rules": [],
  "audit": { "enabled": true },
  "headless": { "defaultDecision": "deny" }
}
```

Audit events are written to `.harness/audit.jsonl` (gitignored). View the last 10 entries with `Ctrl+Shift+A` inside Thanos.
Set `HARNESS_POLICY_FILE=/path/to/harness.policy.json` to point Thanos at a different policy file.

Add rules to restrict or allow specific capabilities, paths, or command families:

```json
{
  "id": "team-deny-env-read",
  "capability": "read",
  "pattern": ".env*",
  "decision": "deny",
  "reason": "Environment files may contain secrets"
}
```

---

## MCP servers

| Server | Type | Purpose |
|--------|------|---------|
| chrome-devtools | stdio | Browser DevTools integration |
| context7 | stdio | Context-aware documentation lookup |
| sequential-thinking | stdio | Step-by-step reasoning |
| convex-mcp | stdio | Convex database integration |
| mgrep | stdio | Fast ripgrep-based code search |
| neon | SSE | Neon Postgres database |
| stitch | SSE | Google Stitch design tools |

Copy `mcp.example.json` to `mcp.json` and fill in your API keys. Use `/mcp auth <server>` within Thanos to store bearer tokens securely in `mcp-secrets.json`.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+T` | Select thinking level |
| `Ctrl+Shift+S` | Show session snapshot (model, spec, policy, context usage) |
| `Ctrl+Shift+E` | Show active spec and verification state |
| `Ctrl+Shift+P` | Show active policy rules |
| `Ctrl+Shift+A` | Show last 10 audit log entries |
| `Ctrl+Shift+R` | Run code review (spawns reviewer subagent) |
| `Ctrl+Shift+D` | Spawn designer agent |
| `Ctrl+Shift+Y` | Toggle yolo mode (bypasses all permission checks) |

---

## Design notes

Architecture decisions are documented in [docs/adr/](docs/adr/). Implementation plans are in [docs/plans/](docs/plans/). The project context and approved design direction are in [CONTEXT.md](CONTEXT.md).
