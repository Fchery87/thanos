import { describe, expect, it, vi } from "vitest";
import register from "../../src/index";

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

describe("/waves command", () => {
  it("injects a bounded waves orchestration prompt as a follow-up", async () => {
    const sendUserMessage = vi.fn(async () => undefined);
    const { api, handlers } = createFakePi({ sendUserMessage } as Partial<RegisterApi>);
    register(api);

    await handlers.get("waves")?.("audit this repo", {
      hasUI: true,
      ui: { notify: vi.fn(), setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    });

    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("draft a bounded wave plan"),
      { deliverAs: "followUp" },
    );
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("audit this repo"),
      { deliverAs: "followUp" },
    );
  });

  it("warns when no goal is provided", async () => {
    const sendUserMessage = vi.fn(async () => undefined);
    const notify = vi.fn();
    const { api, handlers } = createFakePi({ sendUserMessage } as Partial<RegisterApi>);
    register(api);

    await handlers.get("waves")?.("  ", {
      hasUI: true,
      ui: { notify, setStatus: vi.fn(), theme: { fg: (_kind: string, text: string) => text } },
    });

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Pass a goal: /waves <goal>", "warning");
  });
});
