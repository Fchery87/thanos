import type { PolicyPreset, PolicyRule } from "../policy/types";
import type { DeliveryMode } from "./delivery";

/**
 * Policy rules that overlay the base HarnessPolicy for a given delivery mode.
 *
 * The only mode that adds a deny is `local-only`: work scoped local-only must
 * never be able to leave the machine, so any `git push` exec is DENIED.
 *
 * Matching detail (confirmed against src/policy/evaluator.ts +
 * src/governance/rule-match.ts): the evaluator keys ONLY on `capability` and
 * `pattern` (a minimatch glob with `matchBase: true`) against the call's
 * `target`. For a bash tool call the target is the raw command string, so the
 * deny must be expressed as a `pattern` over that string — the `commandFamily`
 * field on PolicyRule is NOT consulted by the evaluator.
 *
 * The evaluator now matches every deny rule against each shell clause
 * (split on `&&`, `||`, `;`, `|`) in addition to the whole command, so chained
 * forms like `cd repo && git push` are caught by the `git push` clause without
 * needing broad patterns. That lets us use tightly ANCHORED patterns that
 * match the `git push` verb at the start of a clause:
 *   - `git push`   — the bare command
 *   - `git push *` — `git push <args>` (the trailing space prevents matching
 *                    `git pushy ...`, and an anchored `*` does not cross into a
 *                    commit message in another clause)
 * These deliberately do NOT match `git commit -m "add push support"`,
 * `cat src/push.ts`, etc. — fixing the prior false positives from `*push *`.
 *
 * KNOWN LIMITATION: `git -C /some/repo push origin` is a single clause whose
 * path argument contains `/`, which a single `*` cannot cross (verified
 * empirically: neither `git*push*` nor `git ** push*` match it under the
 * evaluator's minimatch opts). Catching it would require reintroducing a broad
 * pattern that also re-creates the commit-message false positives, so it is
 * left uncovered rather than over-matching. `git -C dir push` (relative path,
 * no `/`) IS still covered via `git push`-style clause matching only if written
 * as a separate clause; the `-C` form with an absolute path is the gap.
 */
export function deliveryPolicyOverlay(mode: DeliveryMode): PolicyRule[] {
  if (mode !== "local-only") return [];

  const reason = "local-only delivery mode forbids pushing to a remote";
  return [
    {
      id: "delivery-local-only-no-push",
      capability: "exec",
      // `git push <args>` — trailing space anchors on the push verb boundary so
      // `git pushy ...` and commit messages mentioning "push" are NOT matched.
      pattern: "git push *",
      decision: "deny",
      reason,
    },
    {
      id: "delivery-local-only-no-push-bare",
      capability: "exec",
      pattern: "git push",
      decision: "deny",
      reason,
    },
  ];
}

/** Map a delivery mode to the base policy preset it should run under. */
export function presetForMode(mode: DeliveryMode): PolicyPreset {
  switch (mode) {
    case "no-mistakes":
      return "ci";
    case "direct-PR":
      return "team";
    case "local-only":
      return "personal";
  }
}
