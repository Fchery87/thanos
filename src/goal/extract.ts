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
  if (!Array.isArray(messages)) return { lastAssistantText: "", toolResultsText: "" };
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

interface BranchEntryLike {
  type?: string;
  message?: unknown;
}

/**
 * Decode a session branch (entries → messages) and extract the last turn. The
 * goal module's single home for turning `sessionManager.getBranch()` output
 * into evidence. Returns empty evidence for an empty/undefined branch, so a
 * caller that fails closed on "no evidence" behaves correctly if the private
 * branch API ever changes shape.
 */
export function extractLastTurnFromBranch(branch: readonly BranchEntryLike[] | undefined): ExtractedTurn {
  const messages = (branch ?? [])
    .filter((e) => e && e.type === "message" && e.message)
    .map((e) => e.message);
  return extractLastTurn(messages);
}

/**
 * The typed extension AgentEndEvent declares only `messages`; willRetry is a
 * session-level field that may not be passed through. Read defensively.
 */
export function readWillRetry(event: unknown): boolean {
  return typeof event === "object" && event !== null &&
    (event as { willRetry?: unknown }).willRetry === true;
}

/**
 * True when the turn ended because the user aborted it (ESC). Pi's agent loop
 * always closes an aborted run with a final assistant message whose stopReason
 * is "aborted"; scan in reverse because tool-result messages can trail it.
 */
export function readAborted(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const messages = (event as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; stopReason?: string };
    if (m?.role === "assistant") return m.stopReason === "aborted";
  }
  return false;
}
