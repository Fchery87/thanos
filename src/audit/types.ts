export interface AuditTarget {
  kind: "literal" | "pattern" | "bash-command" | "unknown";
  value?: string;
  family?: string;
}

export interface AuditEvent {
  timestamp: string;
  sessionId: string;
  agentType: "parent" | "subagent";
  toolName: string;
  capability: string;
  decision: "allow" | "deny" | "ask";
  ruleId?: string;
  target: AuditTarget;
}
