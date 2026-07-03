# Slash Command Terminal Rendering Fixes

## Summary

Thanos slash command output now uses terminal-safe rendering for the command surfaces most likely to glitch while scrolling:

- `/models` only shows providers with configured authentication.
- `/models` provider/model labels are capped to a stable picker width.
- `/mcp` server picker labels and action titles are capped to a stable picker width.
- `/subagents-models` model references are shortened in the picker while preserving the full selected model reference when saving settings.
- Shared `formatPanel` output is capped to a safe visual width so long paths, policy rules, diagnostics, audit targets, MCP errors, and command help text do not force terminal wrapping.

## Root Cause

Several slash commands rendered raw paths, provider names, model references, MCP server names, or error text directly into terminal panels and interactive selectors. Long rows could exceed the terminal width. In a redraw-heavy TUI, especially while scrolling a selector, those overwide rows can wrap and make the screen appear to tear or glitch.

## Implementation Notes

The shared terminal UI helpers live in `src/ui-utils.ts`:

- `formatPanel` caps panel output to 80 visual columns.
- `makeTerminalSafeOptions` caps selector labels to 72 visual columns and keeps truncated labels unique.
- `fitTerminalText` and `fixedWidthTerminalText` use Pi's ANSI-aware terminal width logic.

Commands that need to map a displayed selector label back to a full value must build safe labels separately and use the selected label index to recover the original value.

## Verification

Regression coverage:

- `tests/ui-utils.test.ts`
- `tests/index.models.test.ts`
- `tests/commands/subagents-models.test.ts`
- `tests/commands/presenters.test.ts`

Final verification after the change:

```bash
bun run typecheck
bun run lint
bun run test
```

Expected full-suite result at implementation time: 90 test files and 551 tests passing.
