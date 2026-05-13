# ADR 0001 — Subagents via subprocess spawn, not in-process `runAgentLoop`

**Status:** Accepted

## Context

The `task` tool needs to run a specialist agent (ask/plan/build/generic) in an isolated context window and return its final text output to the parent agent. Two approaches were considered:

1. **In-process**: Call `runAgentLoop` from `@earendil-works/pi-agent-core` directly inside the tool's `execute()` function, sharing the same Node.js process.

2. **Subprocess**: Spawn a separate `pi` process in JSON mode (`--mode json --agent <type>`), collect JSONL output, parse the `agent_end` event.

## Decision

Use subprocess spawn, mirroring Pi's own official subagent extension example.

## Reasoning

- **True context isolation**: Each subagent gets its own context window. The parent's conversation history does not pollute the child's token budget.
- **Tool capability enforcement**: The agent markdown `tools` frontmatter restricts which tools appear in the LLM's schema. In-process, we'd have to filter tool registrations manually.
- **Extensions load fresh**: The subagent subprocess loads Pi extensions from scratch, respecting its own context — no shared mutable state with the parent.
- **Depth enforcement**: `HARNESS_SUBAGENT=1` env var causes the harness to skip registering `task` in the child process. Clean, hard, testable.
- **Alignment with Pi's design**: Pi's own subagent example uses this pattern. Diverging would mean maintaining our own agent loop that can drift from Pi's evolution.

## Consequences

- Subagent invocation has subprocess startup latency (~1–2s per spawn).
- `pi` binary must be invocable from within the extension. Resolved via `getPiBin()` using `process.argv[1]` — works with node, bun, and script invocations without requiring `pi` in PATH.
- Parallel subagents from the same parent turn each spawn their own process. Pi's parallel tool execution handles this naturally.
- Cannot pass in-memory state (e.g., accumulated session rules) to the subagent. The subagent starts with default permission rules only.
