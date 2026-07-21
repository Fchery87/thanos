import type { Verdict } from "../goal/types";

export function parseExactEvaluatorVerdict(text: string): Verdict {
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  if (lines.length !== 2) {
    const head = trimmed.replace(/\s+/g, " ").slice(0, 120);
    return { met: false, reason: `evaluator output unreadable: ${head}` };
  }

  const verdictLine = lines[0]?.trim() ?? "";
  const reasonLine = lines[1]?.trim() ?? "";
  const verdictMatch = /^VERDICT:\s*(MET|NOT_MET)$/i.exec(verdictLine);
  const reasonMatch = /^REASON:\s*(.+)$/i.exec(reasonLine);
  if (!verdictMatch || !reasonMatch) {
    const head = trimmed.replace(/\s+/g, " ").slice(0, 120);
    return { met: false, reason: `evaluator output unreadable: ${head}` };
  }

  const reason = reasonMatch[1].trim();
  if (!reason) {
    return { met: false, reason: "evaluator output unreadable: missing reason" };
  }

  return { met: verdictMatch[1].toUpperCase() === "MET", reason };
}
