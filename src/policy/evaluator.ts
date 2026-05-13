import type { HarnessPolicy, Decision } from "./types";

export interface PolicyDecision {
  decision: Decision;
  ruleId?: string;
  pattern?: string;
}

export function evaluatePolicy(
  policy: HarnessPolicy,
  capability: string,
  target: string,
): PolicyDecision | null {
  for (const rule of policy.rules) {
    if (rule.capability !== capability && rule.capability !== "*") continue;
    if (rule.pattern && !matchGlob(rule.pattern, target)) continue;
    return { decision: rule.decision, ruleId: rule.id, pattern: rule.pattern };
  }
  return null;
}

function matchGlob(pattern: string, value: string): boolean {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(value) || value.includes(pattern.replace(/\*/g, ""));
}
