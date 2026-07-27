// src/mcp/manager.ts
import type { TSchema } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MCPClient } from "./client";
import { StdioMCPClient, HttpMCPClient } from "./client";
import { loadMcpConfigs, type MCPConfigResult } from "./config";
import type { MCPConfigLevel, MCPServerConfig, MCPTool } from "./types";
import {
  approveMcpIdentity,
  readMcpState,
  setServerDisabled,
  readServerSecrets,
  writeServerSecrets,
  type ServerSecrets,
} from "./state";
import { evaluateMcpTrust, normalizeIdentity, trustKey } from "./trust";
import {
  validateToolCount,
  validateToolDescription,
  validateToolName,
  validateToolResultSize,
} from "./validation";
import { refreshAccessToken } from "./oauth";

export interface ServerStatus {
  name: string;
  source: MCPConfigLevel;
  toolCount: number;
  connected: boolean;
  disabled: boolean;
  error?: string;
  /**
   * Refused by the trust gate rather than failed to connect. Distinct from
   * `error` because the remedy is a decision, not a fix.
   */
  blocked?: boolean;
}

/**
 * What the trust gate needs to know, supplied by the caller that has it.
 *
 * Defaults are the fail-closed ones: no approvals on record, project not
 * vouched for. A caller that forgets to pass them gets the safe answer.
 */
export interface McpTrustInputs {
  approved: Set<string>;
  projectApproved: boolean;
}

const CLOSED_TRUST: McpTrustInputs = { approved: new Set(), projectApproved: false };

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
  private trust: McpTrustInputs = CLOSED_TRUST;
  /** Tools registered across every server this session, for the session cap. */
  private sessionToolCount = 0;

  constructor(deps: MCPManagerDeps = {}) {
    this.deps = {
      loadConfigs: deps.loadConfigs ?? loadMcpConfigs,
      createClient: deps.createClient ?? ((name, config) => {
        if (config.type === "stdio") {
          return new StdioMCPClient(config, { timeoutMs: 30_000 });
        }
        const refreshAuth = async (): Promise<string | null> => {
          const secrets = await readServerSecrets(name);
          const { refreshToken, tokenEndpoint, clientId } = secrets.oauth ?? {};
          if (!refreshToken || !tokenEndpoint) return null;
          try {
            const newToken = await refreshAccessToken({
              tokenEndpoint,
              refreshToken,
              clientId: clientId ?? "pi-harness",
            });
            await writeServerSecrets(name, { headers: { Authorization: `Bearer ${newToken}` } });
            return newToken;
          } catch {
            return null;
          }
        };
        return new HttpMCPClient(config, { timeoutMs: 30_000 }, refreshAuth);
      }),
    };
  }

  // ── Initialization ───────────────────────────────────────────────────────

  async initialize(pi: ExtensionAPI, cwd: string, trust?: Partial<McpTrustInputs>): Promise<void> {
    this.cwd = cwd;
    const { merged, sources } = await this.deps.loadConfigs(cwd);
    const state = await readMcpState();
    const disabledSet = new Set(state.disabled);
    // Approvals come from the state file; whether the project itself is vouched
    // for is the caller's to say (session_start passes pi's isProjectTrusted).
    this.trust = {
      approved: new Set(state.approved),
      projectApproved: trust?.projectApproved ?? false,
    };

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
        // Trust is decided before a client exists, because for a stdio server
        // constructing the client is what spawns the command.
        const decision = this._evaluateTrust(name, config);
        if (!decision.allowed) {
          this.statuses.set(name, {
            name,
            source: sources[name]!,
            toolCount: 0,
            connected: false,
            disabled: false,
            blocked: true,
            error: decision.reason,
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

    // Also gated here, not just at initialize: /mcp connect and /mcp enable
    // reach this directly, and "the user typed a command" is not the same as
    // "the user vouched for this server's command line".
    const decision = this._evaluateTrust(name, config);
    if (!decision.allowed) {
      this.statuses.set(name, {
        name,
        source: this.sources.get(name)!,
        toolCount: 0,
        connected: false,
        disabled: false,
        blocked: true,
        error: decision.reason,
      });
      return false;
    }

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

  /**
   * Record the user's explicit approval of a server's identity, so it connects
   * from now on. Approval is keyed by identity, not by name — a later commit
   * that repoints the same server name at a different command is a different
   * server and must be approved again.
   */
  async approveServer(name: string): Promise<boolean> {
    const config = this.configs.get(name);
    if (!config) return false;
    const key = trustKey(normalizeIdentity({ type: config.type ?? "stdio", command: config.command, args: config.args, url: config.url }));
    await approveMcpIdentity(key);
    this.trust = { ...this.trust, approved: new Set([...this.trust.approved, key]) };
    return true;
  }

  /** The command line a pending approval would authorize, for the prompt. */
  describeServer(name: string): string | undefined {
    const config = this.configs.get(name);
    if (!config) return undefined;
    if ((config.type ?? "stdio") === "stdio") {
      return [config.command, ...(config.args ?? [])].filter(Boolean).join(" ");
    }
    return config.url;
  }

  private _evaluateTrust(name: string, config: MCPServerConfig) {
    const identity = normalizeIdentity({
      type: config.type ?? "stdio",
      command: config.command,
      args: config.args,
      url: config.url,
    });
    // `sources` is populated by initialize for every known server. An unknown
    // source means this server did not come through config loading at all, so
    // treat it as the least trusted thing it could be.
    const source = this.sources.get(name) ?? "project";
    return evaluateMcpTrust(identity, source, this.trust.approved, this.trust.projectApproved);
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

    // A server that answers tools/list with thousands of entries would bury the
    // model's tool set — and every registered tool costs prompt tokens on every
    // turn. Refused wholesale rather than truncated: a server this far outside
    // the envelope is misbehaving, and silently taking the first 200 tools would
    // hide that.
    const countError = validateToolCount(tools.length, this.sessionToolCount + tools.length);
    if (countError) {
      client.disconnect();
      throw new Error(countError.message);
    }

    this.clients.set(name, client);

    let registered = 0;
    for (const tool of tools) {
      if (this._registerTool(pi, name, tool, client)) registered += 1;
    }
    this.sessionToolCount += registered;
    return registered;
  }

  private _disconnectOne(name: string): void {
    const client = this.clients.get(name);
    if (client) {
      client.disconnect();
      this.clients.delete(name);
    }
  }

  /** Returns true if the tool was registered, false if it was refused. */
  private _registerTool(pi: ExtensionAPI, serverName: string, tool: MCPTool, client: MCPClient): boolean {
    // One bad tool skips itself rather than failing the server: a working server
    // with one oddly-named tool should lose that tool, not all of them.
    const nameError = validateToolName(tool.name);
    if (nameError) {
      console.warn(`[harness][mcp] ${serverName}: skipping tool — ${nameError.message}`);
      return false;
    }
    const description = tool.description ?? `MCP tool from ${serverName}`;
    // A tool description is model-facing text supplied by the server, and it is
    // prepended to every turn's prompt. An oversized one is a prompt-injection
    // surface as much as a token cost.
    const descriptionError = validateToolDescription(description);
    if (descriptionError) {
      console.warn(`[harness][mcp] ${serverName}: skipping tool "${tool.name}" — ${descriptionError.message}`);
      return false;
    }

    const parameters = { ...tool.inputSchema } as unknown as TSchema;

    pi.registerTool({
      name: `mcp__${serverName}__${tool.name}`,
      label: `${serverName}: ${tool.name}`,
      description,
      parameters,
      execute: async (_id, params) => {
        const result = await client.callTool(tool.name, params as Record<string, unknown>);
        const rawText = result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");

        // Truncated rather than refused: unlike a malformed name, an oversized
        // result usually means the call genuinely returned a lot, and the useful
        // part is at the start. The notice is inside the text so the model can
        // see that it is working from a partial result.
        const sizeError = validateToolResultSize(rawText.length);
        const text = sizeError
          ? `${rawText.slice(0, 128 * 1024)}\n\n[harness] result truncated — ${sizeError.message}`
          : rawText;

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
    return true;
  }
}
