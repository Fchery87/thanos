import type { MCPServerConfig, MCPTool, MCPToolResult } from "./types";

export interface MCPClient {
  connect(): Promise<void>;
  initialize(): Promise<void>;
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, params: Record<string, unknown>): Promise<MCPToolResult>;
  disconnect(): void;
}

export class StdioMCPClient implements MCPClient {
  constructor(
    private config: MCPServerConfig,
    private opts: { timeoutMs: number },
  ) {}

  async connect(): Promise<void> {}
  async initialize(): Promise<void> {}
  async listTools(): Promise<MCPTool[]> { return []; }
  async callTool(_name: string, _params: Record<string, unknown>): Promise<MCPToolResult> {
    return { content: [{ type: "text", text: "not connected" }], isError: true };
  }
  disconnect(): void {}
}

export class HttpMCPClient implements MCPClient {
  constructor(
    private config: MCPServerConfig,
    private opts: { timeoutMs: number },
  ) {}

  async connect(): Promise<void> {}
  async initialize(): Promise<void> {}
  async listTools(): Promise<MCPTool[]> { return []; }
  async callTool(_name: string, _params: Record<string, unknown>): Promise<MCPToolResult> {
    return { content: [{ type: "text", text: "not connected" }], isError: true };
  }
  disconnect(): void {}
}
