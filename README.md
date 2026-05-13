# Thanos

Personal [Pi coding agent](https://earendil.works) configuration — includes the **Harness** governance extension that adds capability-based permissions, spec lifecycle management, and specialist subagent delegation to every Pi session.

---

## What's in here

```
.pi/
├── agent/
│   ├── extensions/harness/     # Pi governance extension (separate git repo — see note below)
│   ├── skills/                 # Installed Pi skills (mix of symlinks and local dirs)
│   ├── models.json             # Provider and model configuration
│   └── settings.json           # Pi agent settings
├── docs/
│   ├── adr/                    # Architecture Decision Records
│   └── plans/                  # Implementation planning documents
├── CONTEXT.md                  # Harness design glossary and approved direction
├── harness.policy.json         # Active governance policy (root-level default)
├── mcp.example.json            # MCP server config template — copy to mcp.json and add your keys
└── .gitignore
```

> **Note on `agent/extensions/harness/`:** The Harness extension is a separate git repository nested inside this one. It is intentionally excluded from this repo's tracking. To work with it, `cd agent/extensions/harness` and use git commands there directly.

---

## Prerequisites

- [Pi coding agent](https://earendil.works) v0.74.0+
- Node.js v24+ (via [nvm](https://github.com/nvm-sh/nvm))

---

## Setup

**1. Clone to `~/.pi`**

```bash
git clone https://github.com/fchery87/Thanos.git ~/.pi
```

**2. Configure MCP servers**

```bash
cp ~/.pi/mcp.example.json ~/.pi/mcp.json
# Open mcp.json and fill in your API keys where placeholders appear
```

For servers that use bearer tokens (like Neon), use Pi's built-in auth command after starting a session:

```bash
/mcp auth neon
```

This stores the token in `mcp-secrets.json`, which is gitignored and never committed.

**3. Install the Harness extension**

```bash
cd ~/.pi/agent/extensions/harness
npm install
pi install ~/.pi/agent/extensions/harness
```

**4. Start Pi**

```bash
pi
```

---

## Harness extension

The Harness extension (`agent/extensions/harness/`) adds three layers to every Pi session:

### Permission gate

Every tool call is classified by risk tier before it runs:

| Tool | Risk | Capability |
|------|------|-----------|
| `read`, `ls`, `find`, `grep` | low | `read` |
| `write`, `edit` | high | `edit` |
| `bash` | critical | `exec` |
| `task` | medium | `task` |

Edit and exec tools require confirmation by default. Sensitive file paths (credentials, secrets) are denied before any generic read allowance kicks in.

### Spec lifecycle

Pi automatically derives acceptance criteria from your prompt and verifies them after each run. Use `--spec` to require explicit approval before the first write:

```bash
pi --spec
```

### Subagent delegation

The `task` tool lets Pi hand off focused work to specialists:

| Type | Tools available | Use for |
|------|----------------|---------|
| `explore` | read, ls, find, grep | Investigating the codebase |
| `plan` | read, ls, find, grep | Producing implementation plans |
| `build` | read, write, edit, bash | Implementing changes |
| `reviewer` | read + can spawn explore | Code review |
| `designer` | read + write | UI/UX work |

### MCP management

Use `/mcp` within Pi to manage server connections:

```
/mcp list                   # show all servers and status
/mcp enable <name>          # connect a disabled server
/mcp disable <name>         # disconnect and mark disabled
/mcp auth <name>            # set or update credentials
/mcp reload                 # reload all servers from config
```

See [agent/extensions/harness/README.md](agent/extensions/harness/README.md) for full documentation.

---

## Policy

Governance rules live in `harness.policy.json`. The current configuration uses the `team` preset with audit logging enabled and headless mode set to `deny`.

```json
{
  "version": 1,
  "preset": "team",
  "rules": [],
  "audit": { "enabled": true },
  "headless": { "defaultDecision": "deny" }
}
```

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

Audit events are written to `.harness/audit.jsonl` (gitignored). View the last 10 entries with `Ctrl+Shift+A` inside Pi.

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

Copy `mcp.example.json` to `mcp.json` and fill in your API keys. Use `/mcp auth <server>` within Pi to store bearer tokens securely in `mcp-secrets.json`.

---

## Keyboard shortcuts (Harness)

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
