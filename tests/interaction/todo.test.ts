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

  it("round-trips explicit markdown export/import without losing structure", () => {
    const state = createTodoState([{ phase: "Implementation", items: ["Add ask tool"] }]);
    const markdown = exportTodoMarkdown(state);
    const imported = importTodoMarkdown(markdown);
    // ids are internal and not serialized; compare structure excluding id
    expect(imported.phases.map((p) => ({
      name: p.name,
      items: p.items.map(({ content, status, notes }) => ({ content, status, notes })),
    }))).toEqual(state.phases.map((p) => ({
      name: p.name,
      items: p.items.map(({ content, status, notes }) => ({ content, status, notes })),
    })));
  });
});

describe("todo id-based matching", () => {
  it("each item gets a unique id on insert", () => {
    const state = createTodoState([{ phase: "Work", items: ["Task A", "Task B"] }]);
    const ids = state.phases[0].items.map((item) => item.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("completing one of two identical-content todos does not affect the other", () => {
    // Both todos have the exact same content string
    let state = createTodoState([{ phase: "Work", items: ["Do the thing", "Do the thing"] }]);
    const [first, second] = state.phases[0].items;

    // Complete the first item by its id (using task = first item's content; findTask must use id)
    // We drive this via the public API: op "done" with task = content. The fix must ensure
    // only the FIRST match (by insertion order / id) is completed, not both.
    state = applyTodoOperation(state, { op: "done", task: first.id });

    const updatedItems = state.phases[0].items;
    // First item is completed
    expect(updatedItems[0].status).toBe("completed");
    // Second item is now in_progress (was pending, activated), but still its own item
    expect(updatedItems[1].content).toBe("Do the thing");
    expect(updatedItems[1].id).toBe(second.id);
    expect(updatedItems[1].status).toBe("in_progress");
  });

  it("completing one of two identical-content todos via id leaves the other untouched", () => {
    let state = createTodoState([{ phase: "Work", items: ["Repeat", "Repeat", "Repeat"] }]);
    const [a, b, c] = state.phases[0].items;
    expect(new Set([a.id, b.id, c.id]).size).toBe(3); // all distinct

    // Complete only the second item by its id
    state = applyTodoOperation(state, { op: "done", task: b.id });

    expect(state.phases[0].items[0].status).toBe("in_progress"); // a untouched (was in_progress)
    expect(state.phases[0].items[1].status).toBe("completed");   // b completed
    expect(state.phases[0].items[2].status).toBe("pending");      // c untouched
  });
});
