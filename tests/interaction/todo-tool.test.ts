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

  it("initializes phased tasks with first task in progress", async () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));

    const result = await tools.get("todo").execute("todo-1", {
      op: "init",
      list: [{ phase: "Implementation", items: ["Add ask tool", "Add todo tool"] }],
    }, undefined, undefined, { hasUI: true, ui: {} });

    expect(JSON.parse(result.content[0].text).phases[0].items.map((item: any) => item.status)).toEqual(["in_progress", "pending"]);
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
