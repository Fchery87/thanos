const MAX_TOOL_TEXT = 8000;

interface ExtractedTurn {
  lastAssistantText: string;
  toolResultsText: string;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: "text"; text: string } =>
      typeof c === "object" && c !== null && (c as { type?: string }).type === "text")
    .map((c) => c.text)
    .join("\n");
}

/**
 * Extract the last work turn (everything after the final user message) so the
 * tool-less evaluator judges evidence, not the assistant's claims. Tool output
 * is clipped from the head (test summaries/exit codes live at the tail).
 */
export function extractLastTurn(messages: readonly unknown[]): ExtractedTurn {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as { role?: string }).role === "user") { start = i + 1; break; }
  }
  const assistantParts: string[] = [];
  const toolParts: string[] = [];
  for (const raw of messages.slice(start)) {
    const m = raw as { role?: string; toolName?: string; isError?: boolean; content?: unknown };
    if (m.role === "assistant") assistantParts.push(textOf(m.content));
    if (m.role === "toolResult") {
      const flag = m.isError ? " (ERROR)" : "";
      toolParts.push(`[${m.toolName ?? "tool"}${flag}]\n${textOf(m.content)}`);
    }
  }
  let toolResultsText = toolParts.join("\n\n");
  if (toolResultsText.length > MAX_TOOL_TEXT) {
    toolResultsText = `…(clipped)\n${toolResultsText.slice(-MAX_TOOL_TEXT)}`;
  }
  return { lastAssistantText: assistantParts.join("\n").trim(), toolResultsText };
}

/**
 * The typed extension AgentEndEvent declares only `messages`; willRetry is a
 * session-level field that may not be passed through. Read defensively.
 */
export function readWillRetry(event: unknown): boolean {
  return typeof event === "object" && event !== null &&
    (event as { willRetry?: unknown }).willRetry === true;
}
