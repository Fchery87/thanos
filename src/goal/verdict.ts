import type { Verdict } from "./types";

export function parseVerdict(text: string): Verdict {
  const verdictMatch = text.match(/VERDICT:\s*(MET|NOT_MET)/i);
  if (!verdictMatch) {
    const head = text.trim().replace(/\s+/g, " ").slice(0, 120);
    return { met: false, reason: `evaluator output unreadable: ${head}` };
  }
  const met = verdictMatch[1].toUpperCase() === "MET";
  const reasonMatch = text.match(/REASON:\s*(.+)/i);
  const reason = reasonMatch ? reasonMatch[1].trim() : met ? "condition met" : "condition not met";
  return { met, reason };
}
