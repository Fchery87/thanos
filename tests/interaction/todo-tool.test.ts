import { describe, expect, it, vi } from "vitest";
import register from "../../src/index";
import { createTodoState, makeTodoDetails, reconstructTodoState } from "../../src/interaction/todo";

function fakePi(tools: Map<string, any>) {
  return {
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => false),
    on: vi.fn(),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
  } as any;
}

describe("todo tool", () => {
  it("registers todo in main sessions", () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));
    expect(tools.has("todo")).toBe(true);
  });

  it("registers an OpenAI-compatible object parameter schema", () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));
    const schema = tools.get("todo").parameters;

    expect(schema.type).toBe("object");
    expect(schema.anyOf).toBeUndefined();
    expect(schema.oneOf).toBeUndefined();
    expect(schema.allOf).toBeUndefined();
  });

  it("initializes phased tasks with readable markdown output", async () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));

    const result = await tools.get("todo").execute("todo-1", {
      op: "init",
      list: [{ phase: "Implementation", items: ["Add ask tool", "Add todo tool"] }],
    }, undefined, undefined, { hasUI: true, ui: {} });

    expect(result.content[0].text).toBe("# TODO\n\n## Implementation\n- [>] Add ask tool\n- [ ] Add todo tool\n");
  });

  it("exports markdown without writing files", async () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));

    await tools.get("todo").execute("todo-1", {
      op: "init",
      list: [{ phase: "Implementation", items: ["Add ask tool"] }],
    }, undefined, undefined, { hasUI: true, ui: {} });

    const result = await tools.get("todo").execute("todo-2", { op: "export" }, undefined, undefined, { hasUI: true, ui: {} });
    expect(result.content[0].text).toContain("# TODO");
  });
});

describe("reconstructTodoState", () => {
  it("rebuilds the latest todo state from the most recent todo toolResult on the branch", () => {
    const earlier = createTodoState([{ phase: "P1", items: ["a", "b"] }]);
    const later = createTodoState([{ phase: "P1", items: ["a", "b", "c"] }]);
    const branch = [
      { type: "message", message: { role: "toolResult", toolName: "todo", details: makeTodoDetails(earlier) } },
      { type: "message", message: { role: "toolResult", toolName: "todo", details: makeTodoDetails(later) } },
      { type: "message", message: { role: "toolResult", toolName: "other", details: { kind: "x" } } },
    ];
    const result = reconstructTodoState(branch as never);
    expect(result.phases[0].items).toHaveLength(3);
  });

  it("returns empty state when no todo results are present", () => {
    expect(reconstructTodoState([] as never).phases).toHaveLength(0);
  });
});
