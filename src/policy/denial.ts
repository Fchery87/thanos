import type { PolicyDecision } from "./evaluator";

export function formatPolicyDenial(decision: PolicyDecision): string {
  const rule = decision.ruleId ?? decision.decision;
  return decision.pattern ? `Blocked by policy ${rule} (${decision.pattern})` : `Blocked by policy ${rule}`;
}
