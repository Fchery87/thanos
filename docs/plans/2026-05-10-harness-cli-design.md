# Harness CLI Design — 2026-05-10

## Approach

Option A hybrid: Pi.dev as shell (TUI, session management, extension loading, MCP), custom harness as engine (permission model, spec system, subagent delegation) layered on top of `pi-agent-core` via hook intercepts.

---

## Package Structure

```
~/.pi/agent/extensions/harness/
├── index.ts              # Extension entry — registers all hooks and tools
├── permissions/
│   ├── manager.ts        # PermissionManager: session-scoped allow/deny/ask
│   ├── rules.ts          # Capability-based rule evaluation (last-rule-wins)
│   └── risk.ts           # Risk-tier classifier: low | medium | high | critical
├── spec/
│   ├── engine.ts         # SpecEngine: classify → generate → verify
│   ├── classifier.ts     # Heuristic intent classification → SpecTier
│   └── verifier.ts       # Post-run acceptance criterion checking
├── agents/
│   ├── registry.ts       # Specialist definitions: ask, plan, build, generic
│   └── task-tool.ts      # task tool: spawns nested AgentSession
├── hooks/
│   ├── before-tool.ts    # Permission gate + spec scope check
│   └── after-tool.ts     # Drift detection + idempotency cache
└── tools/
    └── index.ts          # Tool registrations
```

---

## Core Agent Loop

Pi's `runAgentLoop` (from `pi-agent-core`) is the execution engine — not replaced, only intercepted via three hooks:

- **`session.start`** — `SpecEngine.classify()` runs heuristic intent classification. Explicit-tier tasks render a TUI spec summary and await `y/n` approval (only triggered via `--spec` flag).
- **`beforeToolCall`** — Hot path: risk classification → permission rule evaluation → `ask` prompt if needed → spec scope warning.
- **`afterToolCall`** — Drift detection + idempotency cache update.

---

## Permission Model

```typescript
type Capability = 'read' | 'search' | 'edit' | 'exec' | 'memory' | 'task'
type Decision = 'allow' | 'deny' | 'ask'

interface PermissionRule {
  capability: Capability | '*'
  pattern?: string      // glob: 'src/**' for edit, 'git *' for exec
  decision: Decision
  source: 'default' | 'user' | 'session' | 'spec' | 'subagent'
}
```

- Last-rule-wins evaluation
- Session decisions cached as rules (no repeated prompts)
- Default: read/search always allow; edit/exec always ask
- Risk tiers: low → allow, medium → check rules, high/critical → always ask unless explicit allow exists
- Subagent narrowing: `PermissionManager.narrow(type)` filters parent rules through specialist ceiling

---

## Spec System

Three tiers, ambient by default:

| Tier | Trigger | UX |
|------|---------|-----|
| `instant` | Single-file reads, Q&A | No spec, run immediately |
| `ambient` | Multi-file edits, moderate complexity | Silent spec, drift warnings, verify table at end |
| `explicit` | Via `--spec` flag | Spec shown in TUI, y/n approval before execution |

`FormalSpec` structure:
```typescript
interface FormalSpec {
  id: string
  tier: SpecTier
  goal: string
  constraints: string[]
  acceptanceCriteria: string[]   // "WHEN X THE SYSTEM SHALL Y"
  targetFiles: string[]          // glob patterns for scope enforcement
  risks: string[]
}
```

Verify phase: keyword matching against tool result log + disk checks. Unmet criteria surface as a follow-up prompt, not a hard block.

---

## Subagent Delegation

Four types: **ask**, **plan**, **build**, **generic**

| Type | Intent | Tools | Depth |
|------|--------|-------|-------|
| `ask` | Understand existing things | read, search | leaf |
| `plan` | Design future things | read, search | leaf |
| `build` | Implement + run | read, edit, exec | leaf |
| `generic` | Escape hatch, caller defines goal | inherits parent ceiling | leaf |

- Depth limit: 1. Subagents cannot call `task`. Hard limit, not a v1 shortcut.
- Parallel execution: Pi's native parallel tool mode — multiple `task` calls in one turn run concurrently.
- Context isolation: only the summary string crosses the parent/child boundary.
- Session branching: each subagent gets its own JSONL branch in Pi's session tree.

---

## Full Event & Data Flow

```
User message
  │
  ├─ session.start → SpecEngine.classify()
  │     └─ explicit (--spec only): render spec → await y/n
  │
  └─ runAgentLoop
        ├─ LLM streams (pi-ai StreamFn)
        ├─ beforeToolCall
        │     ├─ risk.classify()
        │     ├─ PermissionManager.evaluate() → allow | deny | ask
        │     ├─ ask → api.prompt() → cache session rule
        │     └─ spec scope check → warn if out of scope
        ├─ Tool executes (Pi native)
        └─ afterToolCall
              ├─ SpecEngine.trackDrift()
              └─ idempotency cache update
  │
  session.end → SpecEngine.verify() → pass/fail table
        └─ unmet criteria → follow-up prompt
```

---

## What Pi Provides (No Reimplementation Needed)

- JSONL session persistence + branching
- Context compaction
- TUI rendering (pi-tui)
- MCP integration (pi-mcp-adapter)
- Extension loading (hot-reload via jiti)
- Parallel tool execution
- AbortSignal cancellation chain
- npm packaging + distribution
