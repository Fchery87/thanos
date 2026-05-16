import { Type } from "typebox";

export type TodoStatus = "pending" | "in_progress" | "completed" | "abandoned";

let _todoIdCounter = 0;
function nextTodoId(): string {
  _todoIdCounter += 1;
  return String(_todoIdCounter);
}

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  notes: string[];
}

export interface TodoPhase {
  name: string;
  items: TodoItem[];
}

export interface TodoState {
  phases: TodoPhase[];
}

export const TodoInitPhaseSchema = Type.Object({
  phase: Type.String({ minLength: 1 }),
  items: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});

export const TodoParamsSchema = Type.Object({
  op: Type.Union([
    Type.Literal("init"),
    Type.Literal("done"),
    Type.Literal("drop"),
    Type.Literal("append"),
    Type.Literal("note"),
    Type.Literal("export"),
    Type.Literal("import"),
  ], { description: "Operation to apply to the todo state" }),
  list: Type.Optional(Type.Array(TodoInitPhaseSchema, {
    minItems: 1,
    description: "Required when op is init",
  })),
  task: Type.Optional(Type.String({
    minLength: 1,
    description: "Required when op is done, drop, or note",
  })),
  phase: Type.Optional(Type.String({
    minLength: 1,
    description: "Required when op is append",
  })),
  items: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    description: "Required when op is append",
  })),
  text: Type.Optional(Type.String({
    minLength: 1,
    description: "Required when op is note",
  })),
  markdown: Type.Optional(Type.String({ description: "Required when op is import" })),
});

export type TodoOperation =
  | { op: "init"; list: Array<{ phase: string; items: string[] }> }
  | { op: "done"; task: string }
  | { op: "drop"; task: string }
  | { op: "append"; phase: string; items: string[] }
  | { op: "note"; task: string; text: string }
  | { op: "export" }
  | { op: "import"; markdown: string };

function makeItem(content: string, status: TodoStatus): TodoItem {
  return { id: nextTodoId(), content, status, notes: [] };
}

function normalizePhase(phase: TodoPhase): TodoPhase {
  let found = false;
  return {
    ...phase,
    items: phase.items.map((item) => {
      if (item.status === "in_progress") {
        if (found) return { ...item, status: "pending" };
        found = true;
      }
      return { ...item, notes: item.notes ?? [] };
    }),
  };
}

function ensureSingleInProgress(state: TodoState): TodoState {
  let found = false;
  const phases: TodoPhase[] = state.phases.map((phase) => ({
    ...phase,
    items: phase.items.map((item) => {
      const notes = item.notes ?? [];
      if (item.status === "in_progress") {
        if (found) return { ...item, status: "pending" as TodoStatus, notes };
        found = true;
      }
      return { ...item, notes };
    }),
  }));

  if (!found) {
    for (const phase of phases) {
      const pending = phase.items.find((item) => item.status === "pending");
      if (pending) {
        pending.status = "in_progress";
        found = true;
        break;
      }
    }
  }

  return { phases };
}

export function createTodoState(list: Array<{ phase: string; items: string[] }>): TodoState {
  const state: TodoState = {
    phases: list.map(({ phase, items }) => ({
      name: phase,
      items: items.map((content, index) => makeItem(content, index === 0 ? "in_progress" : "pending")),
    })),
  };
  return ensureSingleInProgress(state);
}

function findTask(state: TodoState, task: string): { phase: TodoPhase; item: TodoItem } | undefined {
  for (const phase of state.phases) {
    for (const item of phase.items) {
      if (item.id === task) return { phase, item };
    }
  }
  // Fall back to content match for callers that pass the task text.
  for (const phase of state.phases) {
    for (const item of phase.items) {
      if (item.content === task) return { phase, item };
    }
  }
  return undefined;
}

function activateNextPending(state: TodoState): TodoState {
  for (const phase of state.phases) {
    const next = phase.items.find((item) => item.status === "pending");
    if (next) {
      next.status = "in_progress";
      break;
    }
  }
  return ensureSingleInProgress(state);
}

export function applyTodoOperation(state: TodoState, op: TodoOperation): TodoState {
  if (op.op === "init") return createTodoState(op.list);
  if (op.op === "import") return importTodoMarkdown(op.markdown);

  const next: TodoState = {
    phases: state.phases.map((phase) => ({
      ...phase,
      items: phase.items.map((item) => ({ ...item, notes: [...item.notes] })),
    })),
  };

  if (op.op === "append") {
    const existing = next.phases.find((phase) => phase.name === op.phase);
    if (existing) {
      existing.items.push(...op.items.map((content) => makeItem(content, "pending")));
    } else {
      next.phases.push({ name: op.phase, items: op.items.map((content) => makeItem(content, "pending")) });
    }
    return ensureSingleInProgress(next);
  }

  const found = op.op === "done" || op.op === "drop" || op.op === "note" ? findTask(next, op.task) : undefined;
  if (!found) return next;

  if (op.op === "done") {
    found.item.status = "completed";
    return activateNextPending(next);
  }

  if (op.op === "drop") {
    found.item.status = "abandoned";
    return activateNextPending(next);
  }

  if (op.op === "note") {
    found.item.notes.push(op.text);
    return next;
  }

  return next;
}

function statusToMarker(status: TodoStatus): string {
  if (status === "in_progress") return ">";
  if (status === "completed") return "x";
  if (status === "abandoned") return "-";
  return " ";
}

export function exportTodoMarkdown(state: TodoState): string {
  const lines = ["# TODO", ""];
  for (const phase of state.phases) {
    lines.push(`## ${phase.name}`);
    for (const item of phase.items) {
      lines.push(`- [${statusToMarker(item.status)}] ${item.content}`);
      for (const note of item.notes) lines.push(`  - note: ${note}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function markerToStatus(marker: string): TodoStatus {
  if (marker === ">") return "in_progress";
  if (marker === "x") return "completed";
  if (marker === "-") return "abandoned";
  return "pending";
}

export function importTodoMarkdown(markdown: string): TodoState {
  const lines = markdown.split(/\r?\n/);
  const phases: TodoPhase[] = [];
  let current: TodoPhase | undefined;
  let currentItem: TodoItem | undefined;

  for (const line of lines) {
    const phaseMatch = /^##\s+(.+)$/.exec(line);
    if (phaseMatch) {
      current = { name: phaseMatch[1], items: [] };
      phases.push(current);
      currentItem = undefined;
      continue;
    }

    const itemMatch = /^- \[(.| )\] (.+)$/.exec(line);
    if (itemMatch && current) {
      currentItem = { id: nextTodoId(), content: itemMatch[2], status: markerToStatus(itemMatch[1] ?? " "), notes: [] };
      current.items.push(currentItem);
      continue;
    }

    const noteMatch = /^  - note: (.+)$/.exec(line);
    if (noteMatch && currentItem) {
      currentItem.notes.push(noteMatch[1]);
    }
  }

  return ensureSingleInProgress({ phases: phases.map(normalizePhase) });
}
