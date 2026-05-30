import type { TodoState, TodoStatus } from "./todo";

// Minimal theme shape we depend on (compatible with Pi's Theme and noopTheme).
interface ThemeLike {
  fg(color: string, text: string): string;
  bold?(text: string): string;
}

function glyph(status: TodoStatus, theme: ThemeLike): string {
  if (status === "completed") return theme.fg("success", "✓");
  if (status === "in_progress") return theme.fg("accent", "▶");
  if (status === "abandoned") return theme.fg("dim", "✗");
  return theme.fg("dim", "○");
}

function countDone(state: TodoState): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const phase of state.phases) {
    for (const item of phase.items) {
      total += 1;
      if (item.status === "completed") done += 1;
    }
  }
  return { done, total };
}

/** Render the todo checklist as themed lines (Claude-Code-style panel). */
export function renderTodoLines(state: TodoState, theme: ThemeLike): string[] {
  if (state.phases.length === 0) {
    return [theme.fg("dim", "No todos")];
  }
  const { done, total } = countDone(state);
  const lines: string[] = [theme.fg("muted", `Todo  ${done}/${total} done`)];
  for (const phase of state.phases) {
    lines.push(theme.fg("toolTitle", `  ${phase.name}`));
    for (const item of phase.items) {
      const g = glyph(item.status, theme);
      const text =
        item.status === "completed" || item.status === "abandoned"
          ? theme.fg("dim", item.content)
          : item.status === "in_progress"
            ? theme.fg("text", item.content)
            : theme.fg("muted", item.content);
      lines.push(`  ${g} ${text}`);
      for (const note of item.notes) {
        lines.push(theme.fg("dim", `      ↳ ${note}`));
      }
    }
  }
  return lines;
}

/** Compact one-line summary for the statusline, e.g. "todo:2/8". */
export function todoSummary(state: TodoState): string | undefined {
  const { done, total } = countDone(state);
  if (total === 0) return undefined;
  return `todo:${done}/${total}`;
}
