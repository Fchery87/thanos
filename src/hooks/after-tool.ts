import type { AuditLogger } from "../audit/logger";
import type { SpecEngine } from "../spec/engine";
import { safeInteractionMetadata, type ToolResultEventLike } from "../spec/evidence";


const CTX_TOOL_OUTPUT_LIMIT = 8_000;
const CTX_TOOL_OUTPUT_TAIL = 1_200;

type ToolResultOverride = { content?: Array<{ type: string; text?: string }>; details?: unknown; isError?: boolean };

function isContextModeTool(toolName: string): boolean {
  return toolName.startsWith("ctx_") || toolName.includes("__ctx_");
}

function truncateContextOutput(text: string): string {
  if (text.length <= CTX_TOOL_OUTPUT_LIMIT) return text;
  const headLength = CTX_TOOL_OUTPUT_LIMIT - CTX_TOOL_OUTPUT_TAIL;
  const omitted = text.length - headLength - CTX_TOOL_OUTPUT_TAIL;
  return `${text.slice(0, headLength)}\n\n… [truncated ${omitted} chars from ctx tool output; run a narrower ctx_search or targeted ctx_execute command for the omitted section] …\n\n${text.slice(-CTX_TOOL_OUTPUT_TAIL)}`;
}

function truncateContextToolResult(event: ToolResultEventLike): ToolResultOverride | undefined {
  if (!isContextModeTool(event.toolName) || !event.content) return undefined;
  let changed = false;
  const content = event.content.map((part) => {
    if (part.type !== "text" || typeof part.text !== "string") return part;
    const text = truncateContextOutput(part.text);
    if (text === part.text) return part;
    changed = true;
    return { ...part, text };
  });
  if (!changed) return undefined;
  return {
    content,
    details: {
      ...(typeof event.details === "object" && event.details !== null ? event.details : {}),
      truncated: true,
      originalTextChars: event.content.reduce((sum, part) => sum + (typeof part.text === "string" ? part.text.length : 0), 0),
      displayedTextChars: content.reduce((sum, part) => sum + (typeof part.text === "string" ? part.text.length : 0), 0),
    },
  };
}
export function makeAfterToolHandler(
  spec: SpecEngine,
  auditLogger?: AuditLogger,
  auditContext?: { sessionId: string; agentType: "parent" | "subagent" },
) {
  return async (event: ToolResultEventLike): Promise<ToolResultOverride | undefined> => {
    spec.recordToolResult(event);

    const override = truncateContextToolResult(event);
    const metadata = safeInteractionMetadata(event);
    if (metadata && auditLogger && auditContext) {
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
    }

    return override;
  };
}
