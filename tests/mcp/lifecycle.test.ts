import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { MCPServerConfig } from "../../src/mcp/types";
import {
  connectMcpServer,
  disableMcpServer,
  disconnectMcpServer,
  enableMcpServer,
  initializeMcpSession,
  type McpLifecycleManagerLike,
} from "../../src/mcp/lifecycle";
import type { ServerStatus } from "../../src/mcp/manager";

function status(overrides: Partial<ServerStatus> & Pick<ServerStatus, "name" | "source" | "toolCount" | "connected" | "disabled">): ServerStatus {
  return { ...overrides };
}

function makeManager(args: {
  configs?: Record<string, MCPServerConfig | undefined>;
  statuses?: ServerStatus[];
}) {
  let currentStatuses = args.statuses ? [...args.statuses] : [];
  const configs = new Map(Object.entries(args.configs ?? {}).filter(([, config]) => config !== undefined));

  const manager: McpLifecycleManagerLike & { setStatuses(next: ServerStatus[]): void } = {
    initialize: vi.fn(async () => {}),
    disconnect: vi.fn(() => {}),
    enableServer: vi.fn(async () => false),
    disableServer: vi.fn(async () => false),
    connectServer: vi.fn(async () => false),
    disconnectServer: vi.fn(() => false),
    getConfig: vi.fn((name: string) => configs.get(name)),
    getStatuses: vi.fn(() => currentStatuses),
    setStatuses(next: ServerStatus[]) {
      currentStatuses = [...next];
    },
  };

  return manager;
}

const pi = {} as ExtensionAPI;

describe("mcp lifecycle", () => {
  it("initializes a session and reports the connected count", async () => {
    const manager = makeManager({
      configs: {
        alpha: { type: "stdio" },
        beta: { type: "sse" },
      },
    });
    manager.initialize = vi.fn(async () => {
      manager.setStatuses([
        status({ name: "alpha", source: "project", toolCount: 2, connected: true, disabled: false }),
        status({ name: "beta", source: "user", toolCount: 0, connected: false, disabled: false, error: "boom" }),
      ]);
    });

    const result = await initializeMcpSession({ manager, pi, cwd: "/work" });

    expect(manager.initialize).toHaveBeenCalledWith(pi, "/work");
    expect(result).toMatchObject({
      kind: "ok",
      action: "session-init",
      connectedCount: 1,
    });
    expect(result.statuses).toHaveLength(2);
  });

  it("enables a known server and returns the refreshed status", async () => {
    const manager = makeManager({
      configs: { alpha: { type: "stdio" } },
      statuses: [status({ name: "alpha", source: "project", toolCount: 0, connected: false, disabled: true })],
    });
    manager.enableServer = vi.fn(async () => {
      manager.setStatuses([
        status({ name: "alpha", source: "project", toolCount: 3, connected: true, disabled: false }),
      ]);
      return true;
    });

    const result = await enableMcpServer({ manager, pi, name: "alpha" });

    expect(manager.enableServer).toHaveBeenCalledWith(pi, "alpha");
    expect(result).toMatchObject({
      kind: "ok",
      action: "enable",
      name: "alpha",
      connectedCount: 1,
    });
    expect(result.status).toMatchObject({
      name: "alpha",
      connected: true,
      disabled: false,
      toolCount: 3,
    });
  });

  it("reports unknown servers without calling the manager action", async () => {
    const manager = makeManager({ statuses: [] });

    const result = await connectMcpServer({ manager, pi, name: "missing" });

    expect(result).toMatchObject({
      kind: "unknown-server",
      action: "connect",
      name: "missing",
      connectedCount: 0,
    });
    expect(manager.connectServer).not.toHaveBeenCalled();
  });

  it("reports a failed connection with the status error", async () => {
    const manager = makeManager({
      configs: { alpha: { type: "sse", url: "https://example.invalid" } },
      statuses: [status({ name: "alpha", source: "project", toolCount: 0, connected: false, disabled: false })],
    });
    manager.connectServer = vi.fn(async () => {
      manager.setStatuses([
        status({ name: "alpha", source: "project", toolCount: 0, connected: false, disabled: false, error: "socket broke" }),
      ]);
      return false;
    });

    const result = await connectMcpServer({ manager, pi, name: "alpha" });

    expect(result).toMatchObject({
      kind: "failed",
      action: "connect",
      name: "alpha",
      error: "socket broke",
      connectedCount: 0,
    });
    expect(result.status).toMatchObject({ error: "socket broke" });
  });

  it("marks a known server as disabled", async () => {
    const manager = makeManager({
      configs: { alpha: { type: "stdio" } },
      statuses: [status({ name: "alpha", source: "project", toolCount: 2, connected: true, disabled: false })],
    });
    manager.disableServer = vi.fn(async () => {
      manager.setStatuses([
        status({ name: "alpha", source: "project", toolCount: 0, connected: false, disabled: true }),
      ]);
      return true;
    });

    const result = await disableMcpServer({ manager, name: "alpha" });

    expect(result).toMatchObject({
      kind: "ok",
      action: "disable",
      name: "alpha",
      connectedCount: 0,
    });
    expect(result.status).toMatchObject({ disabled: true, connected: false, toolCount: 0 });
  });

  it("distinguishes a disconnected known server from an unknown one", () => {
    const manager = makeManager({
      configs: { alpha: { type: "stdio" } },
      statuses: [status({ name: "alpha", source: "project", toolCount: 0, connected: false, disabled: false })],
    });

    const result = disconnectMcpServer({ manager, name: "alpha" });

    expect(result).toMatchObject({
      kind: "not-connected",
      action: "disconnect",
      name: "alpha",
      connectedCount: 0,
    });
    expect(manager.disconnectServer).toHaveBeenCalledWith("alpha");
  });
});
