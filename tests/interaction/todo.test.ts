import { describe, expect, it } from "vitest";
import {
  createTodoState,
  applyTodoOperation,
  exportTodoMarkdown,
  importTodoMarkdown,
} from "../../src/interaction/todo";

describe("todo state", () => {
  it("initializes phased tasks with exactly one in-progress task", () => {
    const state = createTodoState([{ phase: "Implementation", items: ["Add ask tool", "Add todo tool"] }]);
    expect(state.phases[0].items.map((item) => item.status)).toEqual(["in_progress", "pending"]);
  });

  it("marks next pending task in progress when current task completes", () => {
    let state = createTodoState([{ phase: "Implementation", items: ["Add ask tool", "Add todo tool"] }]);
    state = applyTodoOperation(state, { op: "done", task: "Add ask tool" });
    expect(state.phases[0].items.map((item) => item.status)).toEqual(["completed", "in_progress"]);
  });

  it("adds notes without changing task identity", () => {
    let state = createTodoState([{ phase: "Implementation", items: ["Add ask tool"] }]);
    state = applyTodoOperation(state, { op: "note", task: "Add ask tool", text: "UI path covered" });
    expect(state.phases[0].items[0]).toMatchObject({ content: "Add ask tool", notes: ["UI path covered"] });
  });

  it("round-trips explicit markdown export/import", () => {
    const state = createTodoState([{ phase: "Implementation", items: ["Add ask tool"] }]);
    const markdown = exportTodoMarkdown(state);
    expect(importTodoMarkdown(markdown)).toEqual(state);
  });
});
