import { splitShellClauses } from "../audit/target";

/** git global options that consume a following argument (separate-token form). */
const GIT_OPTS_WITH_ARG = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);

/** Quote-aware tokenizer: quoted spans are single tokens, quotes stripped. */
function tokenize(clause: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  for (const ch of clause) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * True when any shell clause is a `git … push …` invocation, regardless of
 * interposed global flags (`git -C dir push`, `git --no-pager push`, …).
 * Complements the anchored globs in delivery-overlay.ts (kept for audit
 * parity); this closes the interposed-flag bypass documented there.
 */
export function commandContainsGitPush(command: string): boolean {
  for (const rawClause of splitShellClauses(command)) {
    const tokens = tokenize(rawClause.trim());
    if (tokens.length < 2) continue;
    const program = tokens[0].split("/").pop();
    if (program !== "git") continue;
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (GIT_OPTS_WITH_ARG.has(t)) { i++; continue; } // skip option + its arg
      if (t.startsWith("-")) continue;                 // skip flags & --opt=val
      // first non-flag token after `git` is the subcommand
      if (t === "push") return true;
      break;
    }
  }
  return false;
}

/**
 * tool_call wiring decision: block a `git push` bash command in local-only mode
 * even when interposed flags evade the anchored globs in delivery-overlay.ts.
 * Returns true regardless of autonomy — this closes the local-only + unattended
 * residual exposure documented in that overlay.
 */
export function shouldBlockLocalOnlyPush(mode: string | undefined, toolName: string, input: unknown): boolean {
  if (mode !== "local-only") return false;
  if (toolName !== "bash") return false;
  const command = (input as { command?: unknown })?.command;
  if (typeof command !== "string") return false;
  return commandContainsGitPush(command);
}
