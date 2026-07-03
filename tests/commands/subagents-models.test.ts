import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import register from "../../src/index";
import { stripAnsi } from "../../src/ui-utils";

type Handler = (...args: unknown[]) => unknown;
type RegisterApi = Parameters<typeof register>[0];

function createFakePi(overrides?: Partial<RegisterApi>) {
  const handlers = new Map<string, Handler>();
  const api = {
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => false),
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn((name: string, definition: { handler: Handler }) => {
      handlers.set(name, definition.handler);
    }),
    registerShortcut: vi.fn(),
    sendUserMessage: vi.fn(async () => undefined),
    getThinkingLevel: vi.fn(() => "off"),
    getCommands: vi.fn(() => []),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    ...overrides,
  };
  return { api: api as unknown as RegisterApi, handlers };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/subagents-models command", () => {
  it("registers a visible top-level model setter alias", () => {
    const { api, handlers } = createFakePi();
    register(api);

    expect(handlers.has("subagents-models-set")).toBe(true);
  });

  it("registers a visible top-level model routing toggle", () => {
    const { api, handlers } = createFakePi();
    register(api);

    expect(handlers.has("subagents-models-toggle")).toBe(true);
  });

  it("updates model routing through the registered slash command", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-slash-models-"));
    const agentDir = join(home, ".pi", "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      subagents: { disableBuiltins: true },
    }, null, 2));
    await writeFile(join(agentDir, "models.json"), JSON.stringify({
      providers: {
        theclawbay: {
          models: [{ id: "gpt-5.5", input: ["text", "image"] }],
        },
      },
    }, null, 2));
    vi.stubEnv("HOME", home);

    const notify = vi.fn();
    const { api, handlers } = createFakePi();
    register(api);

    await handlers.get("subagents-models")?.("set reviewer theclawbay/gpt-5.5:high", {
      hasUI: true,
      ui: { notify, setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Updated reviewer"), "info");
    expect(JSON.parse(await readFile(join(agentDir, "settings.json"), "utf-8"))).toMatchObject({
      subagents: {
        disableBuiltins: true,
        agentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5:high" },
        },
      },
    });
  });

  it("opens an active model selector when no model is provided", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-slash-models-"));
    const agentDir = join(home, ".pi", "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      subagents: { disableBuiltins: true },
    }, null, 2));
    await writeFile(join(agentDir, "models.json"), JSON.stringify({
      providers: {
        theclawbay: {
          models: [
            { id: "gpt-5.5", input: ["text", "image"] },
            { id: "gemini-2.5-pro", input: ["text", "image"] },
          ],
        },
      },
    }, null, 2));
    vi.stubEnv("HOME", home);

    const notify = vi.fn();
    const select = vi.fn(async () => "theclawbay/gemini-2.5-pro");
    const { api, handlers } = createFakePi();
    register(api);

    await handlers.get("subagents-models")?.("set reviewer", {
      hasUI: true,
      ui: { notify, select, setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    });

    expect(select).toHaveBeenCalledWith("Choose model for reviewer", [
      "theclawbay/gpt-5.5",
      "theclawbay/gemini-2.5-pro",
    ]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Updated reviewer"), "info");
    expect(JSON.parse(await readFile(join(agentDir, "settings.json"), "utf-8"))).toMatchObject({
      subagents: {
        agentOverrides: {
          reviewer: { model: "theclawbay/gemini-2.5-pro" },
        },
      },
    });
  });

  it("shows terminal-safe model selector labels while saving the selected full model ref", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-slash-models-"));
    const agentDir = join(home, ".pi", "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      subagents: { disableBuiltins: true },
    }, null, 2));
    const longProvider = "provider-with-an-exceptionally-long-name-for-selector-rendering";
    const longModel = "model-with-an-exceptionally-long-name-and-routing-suffix-for-terminal-rendering";
    await writeFile(join(agentDir, "models.json"), JSON.stringify({
      providers: {
        [longProvider]: {
          models: [
            { id: longModel, input: ["text", "image"] },
          ],
        },
      },
    }, null, 2));
    vi.stubEnv("HOME", home);

    const notify = vi.fn();
    const select = vi.fn(async (_title: string, options: string[]) => {
      for (const option of options) {
        expect(stripAnsi(option).length).toBeLessThanOrEqual(72);
      }
      return options[0];
    });
    const { api, handlers } = createFakePi();
    register(api);

    await handlers.get("subagents-models")?.("set reviewer", {
      hasUI: true,
      ui: { notify, select, setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    });

    const selectedRef = `${longProvider}/${longModel}`;
    expect(JSON.parse(await readFile(join(agentDir, "settings.json"), "utf-8"))).toMatchObject({
      subagents: {
        agentOverrides: {
          reviewer: { model: selectedRef },
        },
      },
    });
  });

  it("opens role and model selectors when only set is provided", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-slash-models-"));
    const agentDir = join(home, ".pi", "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      subagents: { disableBuiltins: true },
    }, null, 2));
    await writeFile(join(agentDir, "models.json"), JSON.stringify({
      providers: {
        theclawbay: {
          models: [
            { id: "gpt-5.5", input: ["text", "image"] },
          ],
        },
      },
    }, null, 2));
    vi.stubEnv("HOME", home);

    const notify = vi.fn();
    const select = vi
      .fn()
      .mockResolvedValueOnce("reviewer")
      .mockResolvedValueOnce("theclawbay/gpt-5.5");
    const { api, handlers } = createFakePi();
    register(api);

    await handlers.get("subagents-models")?.("set", {
      hasUI: true,
      ui: { notify, select, setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    });

    expect(select).toHaveBeenNthCalledWith(1, "Choose subagent role", expect.arrayContaining(["reviewer"]));
    expect(select).toHaveBeenNthCalledWith(2, "Choose model for reviewer", ["theclawbay/gpt-5.5"]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Updated reviewer"), "info");
    expect(JSON.parse(await readFile(join(agentDir, "settings.json"), "utf-8"))).toMatchObject({
      subagents: {
        agentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    });
  });

  it("opens role and model selectors from the top-level alias", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-slash-models-"));
    const agentDir = join(home, ".pi", "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      subagents: { disableBuiltins: true },
    }, null, 2));
    await writeFile(join(agentDir, "models.json"), JSON.stringify({
      providers: {
        theclawbay: {
          models: [
            { id: "gpt-5.5", input: ["text", "image"] },
          ],
        },
      },
    }, null, 2));
    vi.stubEnv("HOME", home);

    const notify = vi.fn();
    const select = vi
      .fn()
      .mockResolvedValueOnce("reviewer")
      .mockResolvedValueOnce("theclawbay/gpt-5.5");
    const { api, handlers } = createFakePi();
    register(api);

    await handlers.get("subagents-models-set")?.("", {
      hasUI: true,
      ui: { notify, select, setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    });

    expect(select).toHaveBeenNthCalledWith(1, "Choose subagent role", expect.arrayContaining(["reviewer"]));
    expect(select).toHaveBeenNthCalledWith(2, "Choose model for reviewer", ["theclawbay/gpt-5.5"]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Updated reviewer"), "info");
  });

  it("toggles per-subagent routing off from the top-level toggle command", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-slash-models-"));
    const agentDir = join(home, ".pi", "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      subagents: {
        agentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    }, null, 2));
    await writeFile(join(agentDir, "models.json"), JSON.stringify({
      providers: {
        theclawbay: {
          models: [
            { id: "gpt-5.5", input: ["text", "image"] },
          ],
        },
      },
    }, null, 2));
    vi.stubEnv("HOME", home);

    const notify = vi.fn();
    const { api, handlers } = createFakePi();
    register(api);

    await handlers.get("subagents-models-toggle")?.("off", {
      hasUI: true,
      ui: { notify, select: vi.fn(), setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("disabled"), "info");
    const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf-8"));
    expect(settings.subagents.modelOverridesEnabled).toBe(false);
    expect(settings.subagents.agentOverrides).toBeUndefined();
    expect(settings.subagents.savedAgentOverrides.reviewer).toEqual({ model: "theclawbay/gpt-5.5" });
  });

  it("opens an on/off selector when the toggle command has no args", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-slash-models-"));
    const agentDir = join(home, ".pi", "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      subagents: {
        modelOverridesEnabled: false,
        savedAgentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    }, null, 2));
    await writeFile(join(agentDir, "models.json"), JSON.stringify({
      providers: {
        theclawbay: {
          models: [
            { id: "gpt-5.5", input: ["text", "image"] },
          ],
        },
      },
    }, null, 2));
    vi.stubEnv("HOME", home);

    const notify = vi.fn();
    const select = vi.fn(async () => "on");
    const { api, handlers } = createFakePi();
    register(api);

    await handlers.get("subagents-models-toggle")?.("", {
      hasUI: true,
      ui: { notify, select, setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    });

    expect(select).toHaveBeenCalledWith("Per-subagent model routing", ["on", "off"]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("enabled"), "info");
    expect(JSON.parse(await readFile(join(agentDir, "settings.json"), "utf-8"))).toMatchObject({
      subagents: {
        modelOverridesEnabled: true,
        agentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    });
  });
});
