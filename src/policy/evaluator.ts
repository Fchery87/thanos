import { matchesPattern } from "../governance/rule-match";
import { BUILTIN_SENSITIVE_READ_RULES } from "./presets";
import type { HarnessPolicy, Decision } from "./types";

export interface PolicyDecision {
  decision: Decision;
  ruleId?: string;
  pattern?: string;
}

function matchRule(rule: { capability: string; pattern?: string; decision: Decision; id?: string }, capability: string, target: string): PolicyDecision | null {
  if (rule.capability !== capability && rule.capability !== "*") return null;
  if (rule.pattern && !matchesPattern(rule.pattern, target)) return null;
  return { decision: rule.decision, ruleId: rule.id, pattern: rule.pattern };
}

export function evaluatePolicy(
  policy: HarnessPolicy,
  capability: string,
  target: string,
): PolicyDecision | null {
  // Builtin sensitive-read denies are always evaluated first and cannot be shadowed
  // by user-defined rules, regardless of their position in policy.rules.
  for (const rule of BUILTIN_SENSITIVE_READ_RULES) {
    const match = matchRule(rule, capability, target);
    if (match) return match;
  }

  for (const rule of policy.rules) {
    const match = matchRule(rule, capability, target);
    if (match) return match;
  }
  return null;
}
