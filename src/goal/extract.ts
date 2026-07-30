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
  return readLastAssistantStopReason(event) === "aborted";
}

export function readTerminalFailure(event: unknown): boolean {
  return readLastAssistantStopReason(event) === "error";
}

function readLastAssistantStopReason(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const messages = (event as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; stopReason?: string };
    if (m?.role === "assistant") return m.stopReason;
  }
  return undefined;
}
