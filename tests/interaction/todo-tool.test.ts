import { describe, expect, it, vi } from "vitest";
import register from "../../src/index";

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
