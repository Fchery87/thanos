import { splitShellClauses } from "../audit/target";
import { matchesPattern } from "../governance/rule-match";
import { extractGitFilePath } from "./git-target";
import { BUILTIN_SENSITIVE_READ_RULES } from "../policy/presets";

export type RiskTier = "low" | "medium" | "high" | "critical";

const LOW_RISK = new Set(["read", "ls", "find", "grep"]);
const HIGH_RISK = new Set(["write", "edit"]);

// Interaction/delegation tools this harness explicitly registers or is built
// around, beyond the LOW_RISK/HIGH_RISK builtins: task is the dormant legacy
// delegation tool; ask/todo/report_finding/goal_complete are harness state
// and interaction tools; subagent is the live delegation entry point,
// registered by the pi-subagents package this harness integrates with (its
// per-call governance already comes from agent frontmatter tool lists and
// worktree/policy narrowing, not from prompting on every dispatch). These
// keep their historical "medium" tier.
const KNOWN_MEDIUM_TOOLS = new Set(["task", "ask", "todo", "report_finding", "goal_complete", "subagent"]);

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

function tokenPathForSensitiveCheck(token: string): string | undefined {
  if (token.length === 0 || token.startsWith("-")) return undefined;
  const gitPath = extractGitFilePath(token);
  if (gitPath !== undefined) return gitPath;
  return token;
}

function isSensitiveToken(token: string): boolean {
  const path = tokenPathForSensitiveCheck(token);
  if (path === undefined) return false;
  return BUILTIN_SENSITIVE_READ_RULES.some((rule) =>
    rule.pattern !== undefined && matchesPattern(rule.pattern, path),
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

/**
 * True for every tool name this harness explicitly recognizes and tiers on
 * its own terms — the builtin file tools, bash, and the harness/pi-subagents
 * tools in KNOWN_MEDIUM_TOOLS. Anything else is unrecognized: most commonly
 * an MCP server's tool, but also any future extension's tool this harness was
 * never taught about.
 */
export function isRecognizedTool(toolName: string): boolean {
  return LOW_RISK.has(toolName) || HIGH_RISK.has(toolName) || KNOWN_MEDIUM_TOOLS.has(toolName) || toolName === "bash";
}

export function classifyRisk(toolName: string, input: Record<string, unknown>): RiskTier {
  if (LOW_RISK.has(toolName)) return "low";
  if (toolName === "bash") return bashCommandTier(input.command);
  if (HIGH_RISK.has(toolName)) return "high";
  if (KNOWN_MEDIUM_TOOLS.has(toolName)) return "medium";
  // Unrecognized tool (most commonly an MCP server's): fail safe to high
  // rather than silently trusting a tool this harness was never taught about.
  return "high";
}
