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
 * field on PolicyRule is NOT consulted by the evaluator. We use several glob
 * patterns so the deny holds for the bare command, the common
 * `git push <args>` form, and `git <flags> push <args>` (e.g. `git -C dir
 * push`). Over-matching is the safe direction here: denying too much keeps
 * local-only work local; under-matching would let it escape.
 */
export function deliveryPolicyOverlay(mode: DeliveryMode): PolicyRule[] {
  if (mode !== "local-only") return [];

  const reason = "local-only delivery mode forbids pushing to a remote";
  return [
    {
      id: "delivery-local-only-no-push",
      capability: "exec",
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
    {
      id: "delivery-local-only-no-push-flags",
      capability: "exec",
      // Catches `git <flags> push <args>` such as `git -C /repo push ...`,
      // where the flag value contains a `/` that a single `*` cannot cross.
      // Over-broad on purpose: for local-only, denying too much is safe.
      pattern: "*push *",
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
