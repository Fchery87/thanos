import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";
import {
  createTodoState, applyTodoOperation, exportTodoMarkdown, reconstructTodoState,
  makeTodoDetails, EMPTY_TODO_STATE, TodoParamsSchema,
  type TodoOperation, type TodoState, type TodoDetails,
} from "../../interaction/todo";
import { renderTodoLines, todoSummary } from "../../interaction/todo-render";
import { fitTerminalText } from "../../ui-utils";

/**
 * Owns the single `todoState` shared by session_start/session_tree (which
 * reconstruct it from the session branch), the /todo command (read-only
 * view/export), and the `todo` tool (the only mutator). One instance per
 * registerHarness() call, same lifetime as the session it belongs to.
 */
export class TodoRuntime {
  private state: TodoState = createTodoState([]);

  get current(): TodoState {
    return this.state;
  }

  /** Re-derive todoState from the session branch (called on session_start/session_tree). */
  reconstructFrom(branch: unknown): void {
    this.state = reconstructTodoState(branch as Parameters<typeof reconstructTodoState>[0]);
  }

  apply(op: TodoOperation): TodoState {
    this.state = applyTodoOperation(this.state, op);
    return this.state;
  }

  statusSegment(ctx: ExtensionContext): string | undefined {
    const s = todoSummary(this.state);
    return s ? ctx.ui.theme.fg("accent", s) : undefined;
  }
}

/** /todo — show (or export) the current todo checklist for this branch. */
export function registerTodoCommand(pi: ExtensionAPI, runtime: TodoRuntime): void {
  pi.registerCommand("todo", {
    description: "Show the current todo checklist for this branch",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (trimmed === "export" || !ctx.hasUI) {
        ctx.ui.notify(exportTodoMarkdown(runtime.current), "info");
        return;
      }
      const theme = ctx.ui.theme;
      await ctx.ui.custom<void>((_tui, _theme, _kb, done) => ({
        handleInput(data: string) {
          if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done();
        },
        render(width: number) {
          const lines = ["", ...renderTodoLines(runtime.current, theme), "", theme.fg("dim", "  Press Escape to close")];
          // fitTerminalText is ANSI-aware; a plain slice would count escape codes
          // against the width and could cut a sequence mid-byte, leaking color.
          return lines.map((l) => fitTerminalText(l, width));
        },
        invalidate() {},
      }));
    },
    getArgumentCompletions: (prefix) =>
      "export".startsWith(prefix) ? [{ value: "export", label: "export markdown" }] : null,
  });
}

/** `todo` tool — the only mutator of todoState (op-based: add/update/remove/export). */
export function registerTodoTool(pi: ExtensionAPI, runtime: TodoRuntime): void {
  pi.registerTool({
    name: "todo",
    label: "Manage todo state",
    description: "Track phased tasks with a single in-progress item and explicit export/import.",
    parameters: TodoParamsSchema,
    async execute(_toolCallId, params: TodoOperation) {
      try {
        if (params.op === "export") {
          return {
            content: [{ type: "text" as const, text: exportTodoMarkdown(runtime.current) }],
            details: makeTodoDetails(runtime.current),
          };
        }
        const state = runtime.apply(params);
        return {
          content: [{ type: "text" as const, text: exportTodoMarkdown(state) }],
          details: makeTodoDetails(state),
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: String(err) }], isError: true, details: undefined };
      }
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", String(args.op)), 0, 0);
    },
    renderResult(result, _opts, theme) {
      const details = result.details as TodoDetails | undefined;
      const state = details?.kind === "thanos-todo" ? details.state : EMPTY_TODO_STATE;
      return new Text(renderTodoLines(state, theme).join("\n"), 0, 0);
    },
  });
}
