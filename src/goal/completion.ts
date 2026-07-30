import type { VerificationResult } from "../spec/verification";
import type { Verdict } from "./types";

/**
 * Decide an untrusted Completion Claim from SpecEngine's settled results.
 *
 * Generic fallback templates may help collect evidence but cannot accept the
 * operator's task. Advisory criteria require a qualitative judge; until one is
 * deliberately added to SpecEngine, they fail closed instead of being treated
 * as passed merely because they do not drive continuation.
 */
export function decideCompletionClaim(
  claim: string,
  results: VerificationResult[],
  options: { contractApproved?: boolean } = {},
): Verdict {
  if (results.length === 0) {
    return { met: false, reason: "no active Work Contract produced verifiable criteria" };
  }

  // A deterministic contract is only scaffolding until the operator approves
  // that exact explicit-tier revision. Approval promotes its criteria to the
  // same binding status as semantically extracted or user-authored criteria.
  const operatorResults = options.contractApproved
    ? results
    : results.filter((result) => result.source !== "deterministic_fallback");
  if (operatorResults.length === 0) {
    return {
      met: false,
      reason: "no operator-derived acceptance criteria are available",
    };
  }

  const advisory = operatorResults.filter((result) => result.advisory);
  if (advisory.length > 0) {
    return {
      met: false,
      reason: `advisory criteria still require qualitative judgment: ${advisory.map((result) => result.criterion.statement).join("; ")}`,
    };
  }

  const unmet = operatorResults.filter((result) => !result.passed);
  if (unmet.length > 0) {
    return {
      met: false,
      reason: `unmet Work Contract criteria: ${unmet.map((result) => result.criterion.statement).join("; ")}`,
    };
  }

  return {
    met: true,
    reason: claim.trim() || "all operator-derived SpecEngine criteria passed",
  };
}
