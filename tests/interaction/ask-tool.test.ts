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

describe("ask tool", () => {
  it("registers ask in main sessions", () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));
    expect(tools.has("ask")).toBe(true);
  });

  it("returns selected option from interactive UI", async () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));

    const result = await tools.get("ask").execute("ask-1", {
      question: "Pick one",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      recommended: "a",
    }, undefined, undefined, {
      hasUI: true,
      ui: { select: vi.fn(async () => "b") },
    });

    expect(JSON.parse(result.content[0].text)).toMatchObject({ selected: ["b"], source: "user" });
  });

  it("fails closed in headless mode without configured default", async () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));

    const result = await tools.get("ask").execute("ask-1", {
      question: "Pick one",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      recommended: "a",
    }, undefined, undefined, { hasUI: false, ui: {} });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("interactive UI");
  });
});
