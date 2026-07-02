import type { PolicyPreset, PolicyRule } from "../policy/types";
import type { DeliveryMode } from "./delivery";

/**
 * Policy rules that overlay the base HarnessPolicy for a given delivery mode.
 *
 * The only mode that adds a deny is `local-only`: work scoped local-only must
 * never be able to leave the machine, so any `git push` exec — plus the GitHub
 * CLI publish family (`gh pr/release/repo create`) — is DENIED.
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
 * KNOWN LIMITATION: the deny set covers `git push` and the `gh` publish family
 * (`gh pr create`, `gh release create`, `gh repo create`), each anchored at the
 * START of a (clause-split) command. Two consequences follow:
 *
 *   1. Interposed flags bypass the anchor. ANY `git <flags> push` form — e.g.
 *      `git -C <dir> push` (relative OR absolute path), `git --no-pager push` —
 *      evades these globs, because the flags push the `push` token away from the
 *      clause start. This is now caught SEPARATELY by an argv-level classifier
 *      (`shouldBlockLocalOnlyPush` in push-guard.ts), wired into the tool_call
 *      handler for local-only mode regardless of autonomy. These anchored globs
 *      are retained for audit/policy parity and for the plain `git push` form;
 *      they still deliberately do NOT match commit messages containing " push "
 *      (e.g. `git commit -m "add push support"`), which the argv classifier also
 *      leaves alone. Anchoring keeps benign reads allowed (`gh pr view/list`,
 *      `gh repo view/clone`, `gh release list`).
 *
 *   2. Other remote-mutating commands are NOT caught by these globs at all:
 *      `scp`, `rsync`, `curl`/`wget` uploads, arbitrary publish tools, and the
 *      `gh` family under interposed flags. Enumerating every such program/flag
 *      combination with whole-string globs is not achievable without
 *      unacceptable false positives; extending the argv classifier to `gh` and
 *      other uploaders is future work.
 *
 * With the argv-level `git push` classifier in place, the residual exposure is
 * now non-git uploaders (`scp`/`rsync`/`curl`) rather than interposed-flag
 * `git push`. In local-only's default ATTENDED mode the parent also prompts on
 * every bash command.
 */
export function deliveryPolicyOverlay(mode: DeliveryMode): PolicyRule[] {
  if (mode !== "local-only") return [];

  const reason = "local-only delivery mode forbids pushing to a remote";
  const ghReason =
    "local-only delivery mode forbids publishing to a remote via the GitHub CLI";
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
    {
      id: "delivery-local-only-no-gh-pr",
      capability: "exec",
      // Anchored at clause start so `gh pr view/list/checkout` are NOT denied.
      pattern: "gh pr create*",
      decision: "deny",
      reason: ghReason,
    },
    {
      id: "delivery-local-only-no-gh-release",
      capability: "exec",
      // Anchored at clause start so `gh release list/view` are NOT denied.
      pattern: "gh release create*",
      decision: "deny",
      reason: ghReason,
    },
    {
      id: "delivery-local-only-no-gh-repo",
      capability: "exec",
      // Anchored at clause start so `gh repo view/clone` are NOT denied.
      pattern: "gh repo create*",
      decision: "deny",
      reason: ghReason,
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
