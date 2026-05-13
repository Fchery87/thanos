import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface MCPServerConfig {
  type?: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  disabled?: boolean;
}

export type MCPConfigLevel = "global" | "user" | "project";

export interface MCPConfigResult {
  merged: Record<string, MCPServerConfig>;
  sources: Record<string, MCPConfigLevel>;
}

export interface MCPConfigPaths {
  global: string;
  user: string;
  project: string;
}

export function mcpConfigPaths(cwd: string): MCPConfigPaths {
  const home = process.env.HOME ?? "~";
  return {
    global: join(home, ".pi", "mcp.json"),
    user: join(home, ".pi", "mcp.json"),
    project: join(cwd, "mcp.json"),
  };
}

async function tryReadJson(path: string): Promise<Record<string, MCPServerConfig>> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return (parsed.mcpServers ?? parsed) as Record<string, MCPServerConfig>;
  } catch {
    return {};
  }
}

export async function loadMcpConfigs(cwd: string): Promise<MCPConfigResult> {
  const paths = mcpConfigPaths(cwd);
  const [global_, project] = await Promise.all([
    tryReadJson(paths.global),
    tryReadJson(paths.project),
  ]);

  const merged: Record<string, MCPServerConfig> = { ...global_, ...project };
  const sources: Record<string, MCPConfigLevel> = {};
  for (const k of Object.keys(global_)) sources[k] = "global";
  for (const k of Object.keys(project)) sources[k] = "project";

  return { merged, sources };
}
