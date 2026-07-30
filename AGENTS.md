# AGENTS

## Quick Start

- Use `/models` to select the active model.
- Use `/goal <condition>` for bounded autonomous work.
- Use `/todo` to track phased work.
- `Ctrl+Shift+R` runs the structured read-only critic jury.
- `/waves <goal>` starts the parent-owned, journaled workflow; delegated nodes
  investigate read-only and the main session alone integrates. Use `/waves
  status|pause|resume|cancel|handoff` to control it, and `workflow_yield` to
  bind a candidate revision for jury and SpecEngine acceptance.

## Validation Gates

- Run `bun run typecheck` regularly while editing TypeScript.
- Run the narrowest relevant test file or slice before broadening scope.
- Run `bun run test` once at the end of a completed implementation slice.
- Treat spec/task-contract verification as part of done, not a postscript.
- `bun run measure` reports cold import and per-turn prompt overhead. It is the
  only self-measurement in the repo that has ever been true; keep it that way,
  and do not add a metric that cannot fail.

## Repair-Forward Rules

- Do not revert unrelated user changes.
- If the branch is red, isolate the failing seam, repair it, and re-run the tight loop before expanding.
- Keep changes minimal and align tests with the real public boundary under change.

## Worktree Rules

- Writing agents work in isolated worktrees; read-only specialists do not.
- Do not claim verification that was not actually run.
- Keep artifact-heavy output in `.harness/...` and return references instead of inlining large payloads.

## Tests Must Not Write to the Repo's Own State

`.harness/evolution/events.jsonl` and `.harness/audit.jsonl` are evidence about
how the harness behaves in real use, and several decisions are made by reading
them. A test that reaches the continuation gate or the MCP layer from the repo
root files synthetic rows into that evidence — the suite ends up measuring
itself. Any test that calls `register()` or drives a turn must `chdir` to a
scratch directory first; see `inScratchRepo` in `tests/index.test.ts`.

## Plan Documents

- `docs/plans/` holds **live plans only**.
- Every plan opens with a `**Status:**` line. Without one there is no way to tell
  an active plan from a finished one, and "the active plan doc" below stops
  meaning anything.
- A completed plan is **deleted on completion**, not archived in place. Git keeps
  it (`git show <commit>:docs/plans/<name>`); anything durable in it belongs in an
  ADR, which is the decision layer that is meant to persist.

## Re-entry

- Start with `git status --short` and the active plan doc under `docs/plans/`.
- Prefer the current phase's narrow seam over broad parallel edits.
- Use the deeper docs below only when the current task needs them.

## Deep References

- `docs/architecture/prompt-system.md` for prompt-system boundaries and remaining phases
- `docs/governance.md` for policy, subagents, and review
- `docs/reference.md` for command/tool lookup
