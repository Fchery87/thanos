import type { PolicyDecision } from "./evaluator";

export function formatPolicyDenial(decision: PolicyDecision): string {
  return `Blocked by policy ${decision.ruleId ?? decision.decision}`;
}
