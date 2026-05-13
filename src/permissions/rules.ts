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
    if (rule.pattern && !target.includes(rule.pattern) && !matchGlob(rule.pattern, target)) continue;
    result = rule.decision;
  }
  return result;
}

function matchGlob(pattern: string, value: string): boolean {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(value);
}
