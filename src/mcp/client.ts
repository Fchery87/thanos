import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { MCPServerConfig, MCPTool, MCPToolResult } from "./types";

export interface MCPClient {
  connect(): Promise<void>;
  initialize(): Promise<void>;
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, params: Record<string, unknown>): Promise<MCPToolResult>;
  disconnect(): void;
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const CLIENT_INFO = { name: "pi-harness", version: "1.0.0" };
const PROTOCOL_VERSION = "2024-11-05";

// ══════════════════════════════════════════════════════════════════════════════
// StdioMCPClient
// ══════════════════════════════════════════════════════════════════════════════

export class StdioMCPClient implements MCPClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  private buffer = "";

  constructor(
    private config: MCPServerConfig,
    private opts: { timeoutMs: number },
  ) {}

  async connect(): Promise<void> {
    const { command, args = [], env = {} } = this.config;
    if (!command) throw new Error("StdioMCPClient: config.command is required");

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "inherit"],
        env: { ...process.env, ...env },
      });

      proc.on("error", (err: Error) => {
        reject(new Error(`StdioMCPClient spawn error: ${err.message}`));
      });

      // Once the process is running we consider connect() done.
      // Errors during operation are handled per-request.
      setImmediate(() => {
        this.proc = proc;
        this._setupStdout();
        resolve();
      });
    });
  }

  private _setupStdout(): void {
    const proc = this.proc!;
    proc.stdout!.on("data", (chunk: Buffer | string) => {
      this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.id !== undefined) {
            const pending = this.pending.get(msg.id);
            if (pending) {
              this.pending.delete(msg.id);
              pending.resolve(msg);
            }
          }
        } catch {
          // malformed JSON — ignore
        }
      }
    });
  }

  private _sendRequest(method: string, params?: unknown): Promise<JsonRpcResponse> {
    if (!this.proc) throw new Error("StdioMCPClient: not connected");

    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
    const line = JSON.stringify(request) + "\n";

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`StdioMCPClient: request ${method} timed out after ${this.opts.timeoutMs}ms`));
      }, this.opts.timeoutMs);

      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });

      this.proc!.stdin!.write(line);
    });
  }

  private _sendNotification(method: string, params?: unknown): void {
    if (!this.proc) return;
    const notification: JsonRpcRequest = { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) };
    this.proc.stdin!.write(JSON.stringify(notification) + "\n");
  }

  async initialize(): Promise<void> {
    const response = await this._sendRequest("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    if (response.error) {
      throw new Error(`MCP initialize failed: ${response.error.message}`);
    }
    this._sendNotification("notifications/initialized");
  }

  async listTools(): Promise<MCPTool[]> {
    const response = await this._sendRequest("tools/list", {});
    if (response.error) {
      throw new Error(`MCP tools/list failed: ${response.error.message}`);
    }
    const result = response.result as { tools: MCPTool[] };
    return result.tools ?? [];
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<MCPToolResult> {
    try {
      const response = await this._sendRequest("tools/call", { name, arguments: params });
      if (response.error) {
        return { content: [{ type: "text", text: response.error.message }], isError: true };
      }
      return response.result as MCPToolResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  }

  disconnect(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    // Reject all pending requests
    for (const [, { reject }] of this.pending) {
      reject(new Error("StdioMCPClient: disconnected"));
    }
    this.pending.clear();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// HttpMCPClient
// ══════════════════════════════════════════════════════════════════════════════

export class HttpMCPClient implements MCPClient {
  private nextId = 1;
  private refreshedToken?: string;

  constructor(
    private config: MCPServerConfig,
    private opts: { timeoutMs: number },
    private refreshAuth?: () => Promise<string | null>,
  ) {}

  // HTTP is stateless — connect and disconnect are no-ops.
  async connect(): Promise<void> {}
  disconnect(): void {}

  private async _post(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const url = this.config.url;
    if (!url) throw new Error("HttpMCPClient: config.url is required");

    const id = this.nextId++;
    const body: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...this.config.headers,
      ...(this.refreshedToken ? { Authorization: `Bearer ${this.refreshedToken}` } : {}),
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });

    if (!response.ok) {
      const excerpt = await response.text().catch(() => "");
      throw new Error(`HttpMCPClient: HTTP ${response.status} — ${excerpt.slice(0, 200)}`);
    }

    return response.json() as Promise<JsonRpcResponse>;
  }

  async initialize(): Promise<void> {
    const response = await this._post("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    if (response.error) {
      throw new Error(`MCP initialize failed: ${response.error.message}`);
    }
  }

  async listTools(): Promise<MCPTool[]> {
    const response = await this._post("tools/list", {});
    if (response.error) {
      throw new Error(`MCP tools/list failed: ${response.error.message}`);
    }
    const result = response.result as { tools: MCPTool[] };
    return result.tools ?? [];
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<MCPToolResult> {
    const attempt = async (): Promise<MCPToolResult> => {
      const response = await this._post("tools/call", { name, arguments: params });
      if (response.error) {
        return { content: [{ type: "text", text: response.error.message }], isError: true };
      }
      return response.result as MCPToolResult;
    };

    try {
      return await attempt();
    } catch (err) {
      // Retry once on 401 if we have a refresh callback
      if (this.refreshAuth && err instanceof Error && err.message.includes("HTTP 401")) {
        const newToken = await this.refreshAuth();
        if (newToken) {
          this.refreshedToken = newToken;
          try {
            return await attempt();
          } catch (retryErr) {
            const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            return { content: [{ type: "text", text: msg }], isError: true };
          }
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  }
}
