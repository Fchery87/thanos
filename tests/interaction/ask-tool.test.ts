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

    // The selector now receives rendered display strings, not raw ids.
    const result = await tools.get("ask").execute("ask-1", {
      question: "Pick one",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      recommended: "a",
    }, undefined, undefined, {
      hasUI: true,
      ui: { select: vi.fn(async () => "B"), input: vi.fn() },
    });

    expect(JSON.parse(result.content[0].text)).toMatchObject({ selected: ["b"], source: "user" });
  });

  it("renders the recommended option first, marked, with an Other entry", async () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));

    const select = vi.fn(async (_q: string, _choices: string[]) => "A — first option (Recommended)");
    await tools.get("ask").execute("ask-1", {
      question: "Pick one",
      options: [
        { id: "a", label: "A", description: "first option" },
        { id: "b", label: "B", description: "second option" },
      ],
      recommended: "a",
    }, undefined, undefined, { hasUI: true, ui: { select, input: vi.fn() } });

    const choices = select.mock.calls[0][1] as string[];
    expect(choices[0]).toBe("A — first option (Recommended)");
    expect(choices).toContain("B — second option");
    expect(choices.some((c) => c.startsWith("✎ Other"))).toBe(true);
  });

  it("captures a free-text answer when Other is chosen", async () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));

    const select = vi.fn(async (_q: string, choices: string[]) => choices.find((c) => c.startsWith("✎ Other"))!);
    const input = vi.fn(async () => "my own answer");
    const result = await tools.get("ask").execute("ask-1", {
      question: "Pick one",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      recommended: "a",
    }, undefined, undefined, { hasUI: true, ui: { select, input } });

    expect(input).toHaveBeenCalledOnce();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      selected: ["my own answer"],
      source: "user",
      custom: true,
    });
  });

  it("omits the Other entry when allowOther is false", async () => {
    const tools = new Map<string, any>();
    register(fakePi(tools));

    const select = vi.fn(async (_q: string, _choices: string[]) => "A");
    await tools.get("ask").execute("ask-1", {
      question: "Pick one",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      recommended: "a",
      allowOther: false,
    }, undefined, undefined, { hasUI: true, ui: { select, input: vi.fn() } });

    const choices = select.mock.calls[0][1] as string[];
    expect(choices.some((c) => c.startsWith("✎ Other"))).toBe(false);
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
