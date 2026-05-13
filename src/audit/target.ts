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

export function commandAuditTarget(command: string): AuditTarget {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0] ?? "";
  const family = COMMAND_FAMILIES[cmd];
  return family
    ? { kind: "bash-command", value: command, family }
    : { kind: "bash-command", value: command };
}
