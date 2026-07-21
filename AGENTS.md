# AGENTS

## Quick Start

- Use `/models` to select the active model.
- Use `/goal <condition>` for bounded autonomous work.
- Use `/todo` to track phased work.
- Use `Ctrl+Shift+R` for review and `/waves <goal>` for bounded parallel orchestration.

## Validation Gates

- Run `bun run typecheck` regularly while editing TypeScript.
- Run the narrowest relevant test file or slice before broadening scope.
- Run `bun run test` once at the end of a completed implementation slice.
- Treat spec/task-contract verification as part of done, not a postscript.

## Repair-Forward Rules

- Do not revert unrelated user changes.
- If the branch is red, isolate the failing seam, repair it, and re-run the tight loop before expanding.
- Keep changes minimal and align tests with the real public boundary under change.

## Worktree Rules

- Writing agents work in isolated worktrees; read-only specialists do not.
- Do not claim verification that was not actually run.
- Keep artifact-heavy output in `.harness/...` and return references instead of inlining large payloads.

## Re-entry

- Start with `git status --short` and the active plan doc under `docs/plans/`.
- Prefer the current phase's narrow seam over broad parallel edits.
- Use the deeper docs below only when the current task needs them.

## Deep References

- `docs/architecture/prompt-system.md` for prompt-system boundaries and remaining phases
- `docs/governance.md` for policy, subagents, review, and `/waves`
- `docs/reference.md` for command/tool lookup
