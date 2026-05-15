import { matchesPattern } from "../governance/rule-match";

export type Capability = "read" | "edit" | "exec" | "task";
export type Decision = "allow" | "ask" | "deny";

export interface PermissionRule {
  capability: Capability | "*";
  pattern?: string;
  decision: Decision;
  source: "default" | "session";
}

export function evaluateRules(
  rules: PermissionRule[],
  capability: Capability,
  target: string,
): Decision {
  let result: Decision = "ask";
  for (const rule of rules) {
    if (rule.capability !== capability && rule.capability !== "*") continue;
    if (rule.pattern && !matchesPattern(rule.pattern, target)) continue;
    result = rule.decision;
  }
  return result;
}
