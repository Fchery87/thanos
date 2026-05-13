// src/mcp/manager.ts
import type { TSchema } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MCPClient } from "./client";
import { StdioMCPClient, HttpMCPClient } from "./client";
import { loadMcpConfigs, type MCPConfigResult } from "./config";
import type { MCPConfigLevel, MCPServerConfig, MCPTool } from "./types";
import {
  readMcpState,
  setServerDisabled,
  readServerSecrets,
  type ServerSecrets,
} from "./state";

export interface ServerStatus {
  name: string;
  source: MCPConfigLevel;
  toolCount: number;
  connected: boolean;
  disabled: boolean;
  error?: string;
}

export interface MCPManagerDeps {
  /** Override config loading (useful in tests). */
  loadConfigs?: (cwd: string) => Promise<MCPConfigResult>;
  /** Override client construction (useful in tests). */
  createClient?: (name: string, config: MCPServerConfig) => MCPClient;
}

/** Merge credential secrets onto a server config without mutating the original. */
function applySecrets(config: MCPServerConfig, secrets: ServerSecrets): MCPServerConfig {
  if (config.type === "stdio") {
    const extraEnv = secrets.env ?? {};
    const baseEnv = config.env && !Array.isArray(config.env) ? config.env : {};
    return { ...config, env: { ...baseEnv, ...extraEnv } };
  }
  // sse / http
  return { ...config, headers: { ...config.headers, ...secrets.headers } };
}

export class MCPManager {
  private clients  = new Map<string, MCPClient>();
  private statuses = new Map<string, ServerStatus>();
  private sources  = new Map<string, MCPConfigLevel>();
  private configs  = new Map<string, MCPServerConfig>();
  private deps: Required<MCPManagerDeps>;
  private cwd = "";

  constructor(deps: MCPManagerDeps = {}) {
    this.deps = {
      loadConfigs: deps.loadConfigs ?? loadMcpConfigs,
      createClient: deps.createClient ?? ((_name, config) =>
        config.type === "stdio"
          ? new StdioMCPClient(config, { timeoutMs: 30_000 })
          : new HttpMCPClient(config, { timeoutMs: 30_000 })
      ),
    };
  }

  // ── Initialization ───────────────────────────────────────────────────────

  async initialize(pi: ExtensionAPI, cwd: string): Promise<void> {
    this.cwd = cwd;
    const { merged, sources } = await this.deps.loadConfigs(cwd);
    const state = await readMcpState();
    const disabledSet = new Set(state.disabled);

    // Cache config + source for every known server (needed for enable/auth later)
    for (const [name, config] of Object.entries(merged)) {
      this.configs.set(name, config);
      this.sources.set(name, sources[name]!);
    }

    await Promise.allSettled(
      Object.entries(merged).map(async ([name, config]) => {
        if (disabledSet.has(name)) {
          this.statuses.set(name, {
            name,
            source: sources[name]!,
            toolCount: 0,
            connected: false,
            disabled: true,
          });
          return;
        }
        try {
          const toolCount = await this._connectOne(pi, name, config);
          this.statuses.set(name, { name, source: sources[name]!, toolCount, connected: true, disabled: false });
        } catch (err) {
          this.statuses.set(name, {
            name,
            source: sources[name]!,
            toolCount: 0,
            connected: false,
            disabled: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  // ── Public lifecycle controls ─────────────────────────────────────────────

  /**
   * Mark a server as disabled in the state file and disconnect it if live.
   * Returns false if the server name is not known.
   */
  async disableServer(name: string): Promise<boolean> {
    if (!this.configs.has(name)) return false;
    await setServerDisabled(name, true);
    this._disconnectOne(name);
    const existing = this.statuses.get(name);
    this.statuses.set(name, {
      name,
      source: existing?.source ?? this.sources.get(name)!,
      toolCount: 0,
      connected: false,
      disabled: true,
    });
    return true;
  }

  /**
   * Remove a server from the disabled list and reconnect it.
   * Returns false if the server name is not known.
   */
  async enableServer(pi: ExtensionAPI, name: string): Promise<boolean> {
    if (!this.configs.has(name)) return false;
    await setServerDisabled(name, false);
    return this.connectServer(pi, name);
  }

  /**
   * Connect or reconnect a specific server (transient — does not change state file).
   * Returns false if the server name is not known.
   */
  async connectServer(pi: ExtensionAPI, name: string): Promise<boolean> {
    const config = this.configs.get(name);
    if (!config) return false;
    this._disconnectOne(name); // tear down any existing connection first
    try {
      const toolCount = await this._connectOne(pi, name, config);
      this.statuses.set(name, {
        name,
        source: this.sources.get(name)!,
        toolCount,
        connected: true,
        disabled: false,
      });
      return true;
    } catch (err) {
      this.statuses.set(name, {
        name,
        source: this.sources.get(name)!,
        toolCount: 0,
        connected: false,
        disabled: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Disconnect a specific server without marking it disabled.
   * Returns false if not connected.
   */
  disconnectServer(name: string): boolean {
    if (!this.clients.has(name)) return false;
    this._disconnectOne(name);
    const existing = this.statuses.get(name);
    if (existing) {
      this.statuses.set(name, { ...existing, connected: false, toolCount: 0, error: undefined });
    }
    return true;
  }

  /** Returns the raw (pre-secrets) config for a server, or undefined. */
  getConfig(name: string): MCPServerConfig | undefined {
    return this.configs.get(name);
  }

  /** Returns all known server names (connected, disconnected, disabled). */
  getKnownNames(): string[] {
    return [...this.configs.keys()];
  }

  getStatuses(): ServerStatus[] {
    return [...this.statuses.values()];
  }

  disconnect(): void {
    for (const name of [...this.clients.keys()]) {
      this._disconnectOne(name);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Connect to one server (loads secrets, creates client, registers tools). */
  private async _connectOne(pi: ExtensionAPI, name: string, rawConfig: MCPServerConfig): Promise<number> {
    const secrets = await readServerSecrets(name);
    const config  = applySecrets(rawConfig, secrets);

    const client = this.deps.createClient(name, config);
    await client.connect();
    await client.initialize();
    const tools = await client.listTools();
    this.clients.set(name, client);

    for (const tool of tools) {
      this._registerTool(pi, name, tool, client);
    }
    return tools.length;
  }

  private _disconnectOne(name: string): void {
    const client = this.clients.get(name);
    if (client) {
      client.disconnect();
      this.clients.delete(name);
    }
  }

  private _registerTool(pi: ExtensionAPI, serverName: string, tool: MCPTool, client: MCPClient): void {
    const parameters = { ...tool.inputSchema } as unknown as TSchema;

    pi.registerTool({
      name: `mcp__${serverName}__${tool.name}`,
      label: `${serverName}: ${tool.name}`,
      description: tool.description ?? `MCP tool from ${serverName}`,
      parameters,
      execute: async (_id, params) => {
        const result = await client.callTool(tool.name, params as Record<string, unknown>);
        const text = result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
        if (result.isError) {
          return {
            content: [{ type: "text" as const, text }],
            details: { serverName, toolName: tool.name, isError: true },
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text }],
          details: { serverName, toolName: tool.name, isError: false as const },
        };
      },
    });
  }
}
