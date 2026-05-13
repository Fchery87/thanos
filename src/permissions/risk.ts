export type RiskTier = "low" | "medium" | "high" | "critical";

const LOW_RISK = new Set(["read", "ls", "find", "grep"]);
const CRITICAL_RISK = new Set(["bash"]);
const HIGH_RISK = new Set(["write", "edit"]);

export function classifyRisk(toolName: string, _input: Record<string, unknown>): RiskTier {
  if (LOW_RISK.has(toolName)) return "low";
  if (CRITICAL_RISK.has(toolName)) return "critical";
  if (HIGH_RISK.has(toolName)) return "high";
  return "medium";
}
