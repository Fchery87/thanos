import type { PolicyRule } from "../policy/types";

// Read-only live-roster roles: search/plan/audit specialists that must never
// mutate the repo or execute commands, even if a tool leaks through their
// frontmatter tool list or a prompt injection steers them there. Covers the
// three angle-specific review critics (there is no shared "reviewer" base —
// see ADR 0023) alongside explore/plan/oracle/researcher.
// Exported so tests can assert this set stays a subset of the live catalog
// (src/agents/catalog.ts) — the invariant that broke silently when
// "reviewer" was retired from the catalog but left here, per ADR 0023.
export const READ_ONLY_ROLES: ReadonlySet<string> = new Set([
  "explore", "plan", "oracle", "researcher",
  "reviewer-correctness", "reviewer-security", "reviewer-tests",
]);

/**
 * Policy rules that narrow a live subagent child's effective ceiling down to
 * what its role is meant to do. Prepended onto the base policy exactly like
 * the delivery overlay (src/governance/delivery-overlay.ts), so they cannot
 * be shadowed by a looser policy rule — governance composes through one
 * mechanism. Writer roles (build, worker, scout) and any role name this
 * harness doesn't recognize (including undefined, the parent session) get no
 * narrowing: the base policy ceiling applies unchanged.
 */
export function roleNarrowingOverlay(role: string | undefined): PolicyRule[] {
  if (!role) return [];

  if (READ_ONLY_ROLES.has(role)) {
    return [
      { id: "role-deny-edit", capability: "edit", decision: "deny", reason: `${role} is read-only` },
      { id: "role-deny-exec", capability: "exec", decision: "deny", reason: `${role} is read-only` },
    ];
  }
  if (role === "designer") {
    return [
      { id: "role-deny-exec", capability: "exec", decision: "deny", reason: "designer cannot execute commands" },
    ];
  }
  if (role === "evaluator") {
    return [
      { id: "role-deny-edit", capability: "edit", decision: "deny", reason: "evaluator verifies but never edits" },
    ];
  }
  return [];
}
