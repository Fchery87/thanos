import type { AuditLogger } from "../audit/logger";
import type { SpecEngine } from "../spec/engine";
import { safeInteractionMetadata, type ToolResultEventLike } from "../spec/evidence";

export function makeAfterToolHandler(
  spec: SpecEngine,
  auditLogger?: AuditLogger,
  auditContext?: { sessionId: string; agentType: "parent" | "subagent" },
) {
  return async (event: ToolResultEventLike): Promise<void> => {
    spec.recordToolResult(event);

    const metadata = safeInteractionMetadata(event);
    if (!metadata || !auditLogger || !auditContext) return;

    await auditLogger.record({
      timestamp: new Date().toISOString(),
      sessionId: auditContext.sessionId,
      agentType: auditContext.agentType,
      toolName: event.toolName,
      capability: "interaction",
      decision: event.isError ? "deny" : "allow",
      target: { kind: "literal", value: event.toolName },
      metadata,
    });
  };
}
