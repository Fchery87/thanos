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

/**
 * Stable identity for an approval record.
 *
 * Exported so the approval store and the trust check cannot drift into two
 * spellings of the same key — an approval that fails to match is a silent
 * downgrade to "untrusted", which reads as the gate being broken.
 */
export function trustKey(identity: McpServerIdentity): string {
  return `${identity.type}:${identity.origin}:${identity.command ?? ""}`;
}

/**
 * Decide whether a configured MCP server may be connected.
 *
 * The distinction that matters is where the config came from. `~/.pi/mcp.json`
 * is the user's own file and is trusted outright. `${cwd}/mcp.json` ships inside
 * whatever repository happens to be open, and for a stdio server it names a
 * command that gets spawned — so cloning a repo and opening it here is enough to
 * run its author's chosen binary. That is what this gate is for.
 *
 * @param projectApproved Whether the human has vouched for this project (pi's own
 *   `isProjectTrusted()`). Previously named `hasPolicy`, for the presence of a
 *   harness policy file; an explicit human trust decision is both a stronger
 *   signal and the one the runtime already has.
 */
export function evaluateMcpTrust(
  identity: McpServerIdentity,
  source: "global" | "user" | "project",
  approvedSet: Set<string>,
  projectApproved: boolean,
): McpTrustDecision {
  if (approvedSet.has(trustKey(identity))) {
    return { allowed: true, trustLevel: "trusted", identity };
  }

  if (source === "global" || source === "user") {
    return { allowed: true, trustLevel: "trusted", identity };
  }

  if (source === "project" && projectApproved) {
    return { allowed: true, trustLevel: "project", identity };
  }

  return {
    allowed: false,
    trustLevel: "untrusted",
    identity,
    reason: `project MCP server "${identity.origin}" requires explicit trust approval (/mcp → trust)`,
  };
}

export function environmentAllowlist(_identity: McpServerIdentity): string[] {
  const base = ["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP"];
  return base;
}
