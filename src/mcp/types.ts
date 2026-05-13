export type MCPConfigLevel = "global" | "user" | "project";

export interface MCPServerConfig {
  type?: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  disabled?: boolean;
}

export interface MCPToolInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: MCPToolInputSchema;
}

export interface MCPToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}
