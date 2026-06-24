import type { AuditTarget } from "./types";

const COMMAND_FAMILIES: Record<string, string> = {
  rm: "destructive",
  rmdir: "destructive",
  git: "version-control",
  npm: "package-manager",
  bun: "package-manager",
  curl: "network",
  wget: "network",
  ssh: "network",
  chmod: "permissions",
  chown: "permissions",
};

// Higher index = higher risk; used to pick the most dangerous family
// across multi-clause commands.
const FAMILY_RISK: Record<string, number> = {
  read: 1,
  navigation: 2,
  exec: 3,
  "version-control": 4,
  "package-manager": 5,
  permissions: 6,
  network: 7,
  io: 8,
  destructive: 9,
};

function familyRisk(family: string): number {
  return FAMILY_RISK[family] ?? 0;
}

function classifyClause(clause: string): string | undefined {
  const cmd = clause.trim().split(/\s+/)[0] ?? "";
  return COMMAND_FAMILIES[cmd];
}

/**
 * Split a shell command into its independent sub-commands ("clauses") on the
 * shell operators that sequence/combine commands (`&&`, `||`, `;`, `|`).
 *
 * Shared by the audit classifier and the policy evaluator so that deny rules
 * can be matched per-clause: this is what prevents a chained command such as
 * `cd repo && git push` from slipping past a rule that only matches the
 * `git push` clause.
 *
 * NOTE: this is a naive lexical split that does NOT respect shell quoting or
 * escaping — e.g. `echo "a && b"` is split into `echo "a ` and ` b"`. Treat the
 * clauses as best-effort hints, not a faithful shell parse.
 */
export function splitShellClauses(command: string): string[] {
  return command.split(/&&|\|\||[;|]/);
}

export function commandAuditTarget(command: string): AuditTarget {
  // Split on shell operators that separate independent sub-commands.
  const clauses = splitShellClauses(command);

  let topFamily: string | undefined;
  for (const clause of clauses) {
    const family = classifyClause(clause);
    if (family !== undefined && familyRisk(family) > familyRisk(topFamily ?? "")) {
      topFamily = family;
    }
  }

  return topFamily
    ? { kind: "bash-command", value: command, family: topFamily }
    : { kind: "bash-command", value: command };
}
