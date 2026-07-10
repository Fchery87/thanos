import { splitShellClauses } from "../audit/target";
import { matchesPattern } from "../governance/rule-match";
import { BUILTIN_SENSITIVE_READ_RULES } from "../policy/presets";

export type RiskTier = "low" | "medium" | "high" | "critical";

const LOW_RISK = new Set(["read", "ls", "find", "grep"]);
const HIGH_RISK = new Set(["write", "edit"]);

// Binaries that only inspect state: they cannot write files or mutate the
// working tree on their own. Redirections, substitutions, and expansions are
// disqualified separately, so membership here means "safe as a bare argv".
// Deliberately excluded: env/printenv (dump secrets), sort/uniq (file output
// args), sed/awk (in-place editing), xargs (arbitrary exec).
const READ_ONLY_COMMANDS = new Set([
  "cat", "ls", "head", "tail", "wc", "pwd", "whoami", "which", "file", "stat",
  "du", "df", "date", "uname", "hostname", "id", "tree", "realpath", "readlink",
  "dirname", "basename", "grep", "egrep", "fgrep", "rg", "find", "jq", "diff",
  "cmp", "md5sum", "sha1sum", "sha256sum", "ps", "free", "uptime", "nproc",
  "echo", "printf", "tr", "cut", "nl", "column",
]);

// git subcommands that only inspect repository state. Anything stateful
// (commit, push, stash, branch creation, config, remote, tag) stays critical.
const GIT_READ_SUBCOMMANDS = new Set([
  "status", "log", "diff", "show", "rev-parse", "ls-files", "blame",
  "shortlog", "describe", "cat-file", "count-objects",
]);

// find flags that turn an inspection into a mutation or arbitrary exec.
const FIND_MUTATING_FLAGS = new Set([
  "-delete", "-exec", "-execdir", "-ok", "-okdir",
  "-fls", "-fprint", "-fprint0", "-fprintf",
]);

// Any of these inside a clause defeats static analysis: redirections can make
// a read-only binary write, substitutions/expansions can smuggle arbitrary
// commands or paths, a single `&` backgrounds without being a clause
// separator, and backslashes can disguise sensitive paths.
const CLAUSE_DISQUALIFIER = /[><`$&(){}\\]/;

function stripQuotes(token: string): string {
  return token.replace(/^['"]+|['"]+$/g, "");
}

function isSensitiveToken(token: string): boolean {
  if (token.length === 0 || token.startsWith("-")) return false;
  return BUILTIN_SENSITIVE_READ_RULES.some((rule) =>
    rule.pattern !== undefined && matchesPattern(rule.pattern, token),
  );
}

/** Resolve the git subcommand, skipping global flags (`-C <dir>`, `-c <kv>`, `--paginate`, …). */
function gitSubcommand(tokens: string[]): string | undefined {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (token === "-C" || token === "-c") {
      i++; // flag consumes the next token as its value
      continue;
    }
    if (token.startsWith("-")) continue;
    return token;
  }
  return undefined;
}

function clauseIsReadOnly(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.length === 0) return false;
  if (CLAUSE_DISQUALIFIER.test(trimmed)) return false;

  const tokens = trimmed.split(/\s+/).map(stripQuotes);
  const command = tokens[0] ?? "";

  if (command === "git") {
    const subcommand = gitSubcommand(tokens);
    if (subcommand === undefined || !GIT_READ_SUBCOMMANDS.has(subcommand)) return false;
    // --output turns read subcommands (log/diff) into file writers.
    if (tokens.some((token) => token.startsWith("--output"))) return false;
  } else if (READ_ONLY_COMMANDS.has(command)) {
    if (command === "find" && tokens.some((token) => FIND_MUTATING_FLAGS.has(token))) return false;
  } else {
    return false;
  }

  return !tokens.some(isSensitiveToken);
}

/**
 * Tier a bash command by inspecting its clauses. "low" only when every clause
 * is a recognized read-only invocation with no shell metacharacters and no
 * sensitive targets — the builtin sensitive-read rules are capability:"read"
 * and do not match exec targets, so this check is the net that keeps
 * `cat ~/.ssh/id_rsa` behind a prompt. Anything unrecognized stays "critical"
 * (fail-safe: unknown means dangerous).
 */
function bashCommandTier(command: unknown): RiskTier {
  if (typeof command !== "string" || command.trim().length === 0) return "critical";
  return splitShellClauses(command).every(clauseIsReadOnly) ? "low" : "critical";
}

export function classifyRisk(toolName: string, input: Record<string, unknown>): RiskTier {
  if (LOW_RISK.has(toolName)) return "low";
  if (toolName === "bash") return bashCommandTier(input.command);
  if (HIGH_RISK.has(toolName)) return "high";
  return "medium";
}
