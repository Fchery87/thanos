export interface McpServerIdentity {
  type: "stdio" | "http";
  origin: string;
  command?: string;
  args?: string[];
  packageName?: string;
}

export type TrustLevel = "trusted" | "project" | "untrusted";

export interface McpTrustDecision {
  allowed: boolean;
  trustLevel: TrustLevel;
  identity: McpServerIdentity;
  reason?: string;
}

export function normalizeIdentity(config: {
  type: string;
  command?: string;
  args?: string[];
  url?: string;
}): McpServerIdentity {
  if (config.type === "stdio") {
    return {
      type: "stdio",
      origin: config.command ?? "unknown",
      command: config.command,
      args: config.args,
    };
  }

  let origin = "unknown";
  try {
    origin = new URL(config.url ?? "http://localhost").hostname;
  } catch {
    // leave as unknown
  }

  return {
    type: "http",
    origin,
  };
}

export function evaluateMcpTrust(
  identity: McpServerIdentity,
  source: "global" | "user" | "project",
  approvedSet: Set<string>,
  hasPolicy: boolean,
): McpTrustDecision {
  const key = `${identity.type}:${identity.origin}:${identity.command ?? ""}`;

  if (approvedSet.has(key)) {
    return { allowed: true, trustLevel: "trusted", identity };
  }

  if (source === "global" || source === "user") {
    return { allowed: true, trustLevel: "trusted", identity };
  }

  if (source === "project" && hasPolicy) {
    return { allowed: true, trustLevel: "project", identity };
  }

  return {
    allowed: false,
    trustLevel: "untrusted",
    identity,
    reason: `project MCP server "${identity.origin}" requires explicit trust approval`,
  };
}

export function environmentAllowlist(_identity: McpServerIdentity): string[] {
  const base = ["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP"];
  return base;
}
