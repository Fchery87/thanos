# Reference — tools, commands, shortcuts

## Thanos tools

| Tool | Purpose |
|------|---------|
| `task` | Delegate to a bounded specialist subagent under the current policy ceiling (see [Governed subagents](governance.md#governed-subagents)) |
| `todo` | Track phased tasks with in-progress state and export/import |
| `ask` | Governed option-based question → decision record |
| `report_finding` | Record structured P0–P3 review findings |

## Slash commands

| Command | Description |
|---------|-------------|
| `/models` | Two-step provider → model selector for providers with configured credentials; includes reasoning/image badges |
| `/subagents-models` | Show per-subagent model routing, saved assignments, and usage |
| `/subagents-models-set [role]` | Select a role, then choose one of your active catalog models for that subagent |
| `/subagents-models-toggle [on\|off]` | Enable per-subagent routing or disable it so `/models` controls all subagents |
| `/designer [goal]` | Spawn the Designer subagent for UI/UX implementation, review, or design-system audit |
| `/run designer <task>` | Run Designer through `pi-subagents` directly; also appears in `/run` completions after reload |
| `/lens` | Thanos Lens Lite: changed files, read-before-modify guard, secret scan, manual diagnostics |
| `/goal [condition\|pause\|resume\|clear]` | Set a self-checking goal; the agent auto-continues until a fresh evaluator confirms it. No arg shows status. Main session only; pauses on ceilings. See [`/goal`](guide.md#goal--self-checking-autonomous-loop) |
| `/waves <goal>` | Run a bounded WAVES orchestration: discover the shape, plan independent slices, fan out parallel workers, verify handoffs, synthesize one deliverable. See [Bounded waves](governance.md#bounded-waves-waves) |
| `/todo` | Show the current todo checklist for this branch (Escape to close); `/todo export` prints the markdown |
| `/modes` | Select the default specialist mode used by `task` when `type` is omitted (`explore`, `plan`, `build`, `reviewer`, `designer`, `oracle`, `researcher`, `evaluator`) |
| `/yolo` | Toggle yolo mode for this session (bypasses thanos permission checks; Lens Lite secret scan still runs). Refuses when yolo is locked by config — see [Yolo lockout](governance.md#yolo-lockout) |
| `/ship` | Deliver the current branch per the resolved [delivery mode](governance.md#delivery-modes) (local-only: fast-forward merge into the default branch; main session only) |
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

## Keyboard shortcuts

All shortcuts use `Ctrl+Shift+<key>` for cross-platform consistency. On macOS, press Control (not ⌘ Command) + Shift + key.

| Shortcut | Action | Mnemonic |
|----------|--------|----------|
| `Ctrl+Shift+K` | Select thinking level | **K** = thin**k**ing |
| `Ctrl+Shift+F` | Show session snapshot (model, spec, policy, context) | **F** = full status |
| `Ctrl+Shift+E` | Show active spec and verification state | **E** = **e**xpand spec |
| `Ctrl+Shift+G` | Show active policy rules | **G** = **g**overnance |
| `Ctrl+Shift+A` | Show last 10 audit log entries | **A** = **a**udit |
| `Ctrl+Shift+R` | Run code review (heterogeneous critic jury + devil's advocate) | **R** = **r**eview |
| `Ctrl+Shift+D` | Spawn designer agent | **D** = **d**esigner |
| `Ctrl+Shift+Y` | Toggle yolo mode | **Y** = **y**olo |

### pi-web-access shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Review search results (curator) |
| `Ctrl+Shift+N` | Toggle web search activity widget |
