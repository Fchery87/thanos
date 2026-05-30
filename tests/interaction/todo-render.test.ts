import { describe, it, expect } from "vitest";
import { renderTodoLines } from "../../src/interaction/todo-render";
import { createTodoState, applyTodoOperation } from "../../src/interaction/todo";
import { noopTheme } from "../../src/ui-utils";

describe("renderTodoLines", () => {
  it("marks completed, in-progress, and pending items distinctly and shows a count", () => {
    let state = createTodoState([{ phase: "Setup", items: ["one", "two", "three"] }]);
    state = applyTodoOperation(state, { op: "done", task: "one" });
    const lines = renderTodoLines(state, noopTheme).join("\n");
    expect(lines).toContain("Setup");
    expect(lines).toContain("one");      // completed
    expect(lines).toContain("two");      // now in_progress
    expect(lines).toMatch(/1\/3/);       // completion count
  });

  it("renders an empty hint when there are no phases", () => {
    const lines = renderTodoLines(createTodoState([]), noopTheme).join("\n");
    expect(lines.toLowerCase()).toContain("no todos");
  });
});
