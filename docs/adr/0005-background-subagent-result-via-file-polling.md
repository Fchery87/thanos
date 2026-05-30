# ADR 0005 — Background subagent results via file polling

**Status:** Accepted

## Context

Subagents run as Pi subprocesses spawned by the governed `task` tool. In the foreground (default) case, `executeTask` returns a single `Promise<string>` that resolves with the **Subagent Result Contract** when the child's process closes; the parent's tool call blocks until then. This is the right model for a bounded specialist whose answer the parent needs before continuing.

Phase 2 adds an **opt-in background mode** so a writing subagent (e.g. a long `build` or `designer` run) can continue past the parent's current turn without blocking it. Pi's tool API delivers exactly one result per tool call — there is no built-in channel to push a second, later result back into the parent's context after the tool has returned. So a background run needs an out-of-band delivery channel. Two options were genuinely on the table:

- **(a) Re-inject** the contract into the parent's context when the background run finishes.
- **(b) File polling** — write the finished contract to `.harness/subagents/<id>.result.json` and return a handle immediately; the parent reads the file when it chooses to.

## Decision

Use **(b) file polling**. When `task` is called with `background: true`:

1. `executeTask` generates a short `<id>`, spawns the child, attaches the close/error handlers, and **resolves immediately** with a handle: `{ backgrounded: true, id, resultPath: ".harness/subagents/<id>.result.json", summary }`.
2. The child's `close` handler still runs to completion: it builds the contract, writes transcript metadata, and writes the full contract JSON to `.harness/subagents/<id>.result.json` (ensuring the directory exists first), then performs worktree/tmp cleanup. It does **not** resolve the (already-settled) outer promise.
3. The parent polls the result file with its existing `read` tool when it wants the outcome. No new polling tool is introduced.

Foreground behavior is byte-for-byte unchanged: the promise resolves in the close handler with the contract payload.

## Reasoning

- **Keeps the orchestrator context lean.** The parent pays for the result only when it deliberately reads the file, instead of having a large contract re-injected into its context at an arbitrary point mid-turn. This matches the same lean-context principle behind **Artifact References**.
- **Reuses an existing, audited path.** Background results land next to the transcript metadata the harness already writes under `.harness/subagents/`, so audit and cleanup stay uniform.
- **No fighting the tool model.** Re-injection (a) would require a side-channel to mutate parent context after a tool returns — exactly the kind of ungoverned intercom the **Governed Clarification** design avoids. File polling stays within the parent-owns-its-own-reads model.
- **Deterministic and inspectable.** The result file is a plain JSON artifact a human or CI can inspect after the fact, consistent with the policy-first, auditable posture of the harness.

## Consequences

- `task` params gain an optional `background?: boolean`; foreground is the default.
- A background result is delivered asynchronously; the parent must poll `resultPath`. If the parent never polls, the result persists on disk as an inspectable artifact (subject to normal `.harness/` hygiene).
- The result-file write must create `.harness/subagents/` itself rather than relying on the fire-and-forget transcript write having created it first (a race that would otherwise silently drop the first background result in a fresh repo).
- If the parent process exits while a background child is still running, the child may be orphaned; dead-pid worktrees are reclaimed by `gcWorktrees`. Robust orphan reaping for non-worktree background runs is a future follow-up, not part of this decision.
- Reversible-ish: switching to re-injection later would change the parent-facing contract (handle + file vs. a pushed result), which is why this is recorded as an ADR.
