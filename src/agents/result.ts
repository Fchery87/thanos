export interface SubagentResult {
  text: string;
  metadata?: Record<string, unknown>;
}

export function parseSubagentResult(text: string): SubagentResult {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "text" in parsed) {
      return parsed as SubagentResult;
    }
  } catch {
    // not JSON — treat as plain text
  }
  return { text };
}
