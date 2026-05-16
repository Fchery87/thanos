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

export function commandAuditTarget(command: string): AuditTarget {
  // Split on shell operators that separate independent sub-commands.
  const clauses = command.split(/&&|\|\||[;|]/);

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
