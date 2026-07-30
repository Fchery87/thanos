export type EgressClass =
  | "local"        // read-only local filesystem or process inspection
  | "local-mutate" // write/mutate local filesystem
  | "repo-remote"  // git push/pull/fetch to a tracked remote
  | "network"      // any outbound network call (curl, wget, etc.)
  | "credentialed" // network call with credentials or auth tokens
  | "unknown";     // cannot classify — fail safe

const NETWORK_COMMANDS = new Set([
  "curl", "wget", "scp", "rsync", "ssh", "sftp",
  "nc", "ncat", "netcat", "telnet",
]);

const PACKAGE_PUBLISH_COMMANDS = new Set([
  "npm", "npx", "yarn", "pnpm", "bun", "pip", "pip3",
  "cargo", "go", "gem", "composer", "docker",
]);

const GIT_PUSH_SUBCOMMANDS = new Set(["push", "pull", "fetch", "clone", "remote"]);

function isGitPushSubcommand(subcommand: string): boolean {
  return GIT_PUSH_SUBCOMMANDS.has(subcommand);
}

function isNetworkCommand(command: string): boolean {
  return NETWORK_COMMANDS.has(command);
}

function isPublishRelatedCommand(command: string): boolean {
  return PACKAGE_PUBLISH_COMMANDS.has(command);
}

function hasCredentialsFlag(argv: string[]): boolean {
  for (const arg of argv) {
    if (/^--?(?:header|H)$/.test(arg)) return true;
    if (/^Authorization:/.test(arg)) return true;
    if (/^Bearer\s/.test(arg)) return true;
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "-H" || a === "--header") {
      const next = argv[i + 1] ?? "";
      if (/^Authorization:/i.test(next) || /^Cookie:/i.test(next) || /^X-API-Key:/i.test(next)) {
        return true;
      }
    }
  }
  return false;
}

export function classifyEgress(toolName: string, input: Record<string, unknown>): EgressClass {
  if (toolName !== "bash") {
    return "local";
  }

  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (command.length === 0) return "unknown";

  const argv = command.split(/\s+/);
  const normalizedTokens = argv.map((token) => token.replace(/^[;&|(){}]+|[;&|(){}]+$/g, ""));
  const baseCommand = argv[0] ?? "";

  // A bash input is a program, not one argv. Inspect every command position so
  // `echo ready && curl ...`, pipelines, and subshells cannot inherit the first
  // harmless command's classification.
  if (hasCredentialsFlag(argv)) {
    if (normalizedTokens.some(isNetworkCommand) || normalizedTokens.includes("git")) {
      return "credentialed";
    }
  }

  if (normalizedTokens.some(isNetworkCommand)) {
    return "network";
  }

  for (let i = 0; i < normalizedTokens.length; i++) {
    if (normalizedTokens[i] !== "git") continue;
    const subcommand = findGitSubcommand(normalizedTokens.slice(i));
    if (subcommand === undefined) return "unknown";
    if (isGitPushSubcommand(subcommand)) return "repo-remote";
  }

  const publishSubcommands = new Set(["publish", "push", "deploy", "upload"]);
  for (let i = 0; i < normalizedTokens.length - 1; i++) {
    if (isPublishRelatedCommand(normalizedTokens[i] ?? "") && publishSubcommands.has(normalizedTokens[i + 1] ?? "")) {
      return "network";
    }
  }

  if (baseCommand === "git" && findGitSubcommand(argv) === undefined) return "unknown";
  return "local";
}

function findGitSubcommand(tokens: string[]): string | undefined {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (token === "-C" || token === "-c") {
      i++;
      continue;
    }
    if (token.startsWith("-")) continue;
    return token;
  }
  return undefined;
}

export interface EgressDecision {
  allowed: boolean;
  reason?: string;
  egressClass: EgressClass;
}

export function evaluateEgress(
  egressClass: EgressClass,
  mode: string | undefined,
  yolo: boolean,
): EgressDecision {
  if (egressClass === "local" || egressClass === "local-mutate") {
    return { allowed: true, egressClass };
  }

  if (yolo) {
    return { allowed: true, egressClass };
  }

  if (mode === "local-only") {
    if (egressClass === "unknown") {
      return {
        allowed: false,
        reason: "local-only mode blocks unrecognized egress commands",
        egressClass,
      };
    }
    return {
      allowed: false,
      reason: `local-only mode blocks ${egressClass} egress`,
      egressClass,
    };
  }

  return { allowed: true, egressClass };
}
