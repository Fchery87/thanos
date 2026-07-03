import { describe, expect, it, vi } from "vitest";
import register from "../src/index";
import { noopTheme, stripAnsi } from "../src/ui-utils";

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
    setModel: vi.fn(async () => true),
    ...overrides,
  };
  return { api: api as unknown as RegisterApi, handlers };
}

describe("register /models command", () => {
  it("keeps provider and model picker labels within a terminal-safe width", async () => {
    const select = vi.fn(async (_title: string, options: string[]) => {
      for (const option of options) {
        expect(stripAnsi(option).length).toBeLessThanOrEqual(72);
      }
      return options[0];
    });
    const { api, handlers } = createFakePi();

    register(api);

    await handlers.get("models")?.("", {
      hasUI: true,
      model: {
        provider: "provider-with-a-very-long-display-name-for-terminal-testing",
        id: "current-model",
      },
      modelRegistry: {
        getAll: () => [
          {
            provider: "provider-with-a-very-long-display-name-for-terminal-testing",
            id: "claude-sonnet-4-20250514-with-an-extra-long-routing-suffix",
            name: "Claude Sonnet 4 with an exceptionally long marketing display name",
            reasoning: true,
            input: ["text", "image"],
            contextWindow: 200_000,
            maxTokens: 64_000,
          },
          {
            provider: "provider-with-a-very-long-display-name-for-terminal-testing",
            id: "current-model",
            name: "Current model",
            reasoning: false,
            input: ["text"],
            contextWindow: 128_000,
            maxTokens: 8_000,
          },
        ],
        hasConfiguredAuth: () => true,
      },
      ui: {
        select,
        notify: vi.fn(),
        setStatus: vi.fn(),
        theme: noopTheme,
      },
    });

    expect(select).toHaveBeenCalledTimes(2);
  });

  it("only shows providers with configured authentication", async () => {
    const select = vi.fn(async (_title: string, options: string[]) => options[0]);
    const { api, handlers } = createFakePi();

    register(api);

    await handlers.get("models")?.("", {
      hasUI: true,
      model: undefined,
      modelRegistry: {
        getAll: () => [
          {
            provider: "configured-provider",
            id: "configured-model",
            name: "Configured Model",
            reasoning: false,
            input: ["text"],
            contextWindow: 128_000,
            maxTokens: 8_000,
          },
          {
            provider: "missing-key-provider",
            id: "missing-key-model",
            name: "Missing Key Model",
            reasoning: false,
            input: ["text"],
            contextWindow: 128_000,
            maxTokens: 8_000,
          },
        ],
        hasConfiguredAuth: (model: { provider: string }) => model.provider === "configured-provider",
      },
      ui: {
        select,
        notify: vi.fn(),
        setStatus: vi.fn(),
        theme: noopTheme,
      },
    });

    const providerOptions = select.mock.calls[0]?.[1] ?? [];
    expect(providerOptions).toHaveLength(1);
    expect(providerOptions[0]).toContain("configured-provider");
    expect(providerOptions[0]).not.toContain("missing-key-provider");
  });

  it("warns instead of opening a selector when no provider has configured authentication", async () => {
    const select = vi.fn();
    const notify = vi.fn();
    const { api, handlers } = createFakePi();

    register(api);

    await handlers.get("models")?.("", {
      hasUI: true,
      model: undefined,
      modelRegistry: {
        getAll: () => [
          {
            provider: "missing-key-provider",
            id: "missing-key-model",
            name: "Missing Key Model",
            reasoning: false,
            input: ["text"],
            contextWindow: 128_000,
            maxTokens: 8_000,
          },
        ],
        hasConfiguredAuth: () => false,
      },
      ui: {
        select,
        notify,
        setStatus: vi.fn(),
        theme: noopTheme,
      },
    });

    expect(select).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No configured model providers found"), "warning");
  });
});
