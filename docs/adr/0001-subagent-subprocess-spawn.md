# ADR 0001 — Subagents via subprocess spawn, not in-process `runAgentLoop`

**Status:** Accepted (context-isolation default partially superseded by ADR 0004, which adds an opt-in `forked` context mode for continuity roles; depth model clarified by the 2026-06-27 addendum below)

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

## Addendum (2026-06-27) — depth model: legacy `task` vs live `subagent`

The "Depth enforcement" reasoning above describes the **legacy `task` tool**, and
remains accurate for it: `HARNESS_SUBAGENT=1` skips registering `task` in the
child, so that path is depth-1 (children are leaves). That tool is now dormant
(gated behind `THANOS_LEGACY_TASK=1`; see `src/agents/registry.ts`).

The **live roster** is dispatched by the pi-subagents engine via the `subagent`
tool, which has a different, deliberately bounded depth model:

- Nesting is capped by `maxSubagentDepth` (engine default **2**); a run is blocked
  when `depth >= maxDepth`. So a normally-dispatched specialist runs at depth 1
  and may spawn **one** further level (depth 2); a depth-2 child cannot spawn again.
- This is intentional, not accidental: it lets a specialist delegate a capability
  it deliberately lacks — canonically, the exec-denied `designer` delegating a
  render + screenshot to `build` for its self-validation loop — without enabling
  uncontrolled deep trees.
- Validated live on 2026-06-27 (designer Phase 1 smoke test; non-Anthropic model):
  a depth-1 `designer` successfully spawned a depth-2 `build` child. See
  `docs/plans/2026-06-27-designer-phase1-smoke-test.md` and
  `docs/main-agent-orchestrator-workflow.md`.

Net: "depth-1 only" holds for the legacy `task` tool; the live `subagent` engine
is "bounded nesting, depth ≤ 2." The deep-nesting anti-pattern stance is unchanged.
