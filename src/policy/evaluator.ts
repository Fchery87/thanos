import { splitShellClauses } from "../audit/target";
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

/**
 * Evaluate the builtin sensitive-read rules first (they cannot be shadowed by
 * user-defined rules, regardless of position in policy.rules), then the policy
 * rules. Returns the first matching decision, or null. Operates on a single
 * string — used both for the whole command and for each shell clause.
 */
function firstMatch(policy: HarnessPolicy, capability: string, target: string): PolicyDecision | null {
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

export function evaluatePolicy(
  policy: HarnessPolicy,
  capability: string,
  target: string,
): PolicyDecision | null {
  // 1. Evaluate the whole target string exactly as before.
  const whole = firstMatch(policy, capability, target);

  // 2. A whole-string deny is final — return it unchanged.
  if (whole?.decision === "deny") return whole;

  // 3. ADDITIVE clause-split deny, exec only: a chained command such as
  //    `cd repo && git push` must not slip past a deny rule that only matches
  //    the `git push` clause. We re-evaluate each sub-clause and surface the
  //    first clause-level deny. This can only ever turn a non-deny result into
  //    a deny; allow/ask/null results from non-deny clauses are ignored, so the
  //    original whole-string decision is preserved in every other case.
  if (capability === "exec") {
    for (const rawClause of splitShellClauses(target)) {
      const clause = rawClause.trim();
      if (clause.length === 0) continue;
      const clauseMatch = firstMatch(policy, capability, clause);
      if (clauseMatch?.decision === "deny") return clauseMatch;
    }
  }

  // 4. No clause deny found (or non-exec capability): original result stands.
  return whole;
}
