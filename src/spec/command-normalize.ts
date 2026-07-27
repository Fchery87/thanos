import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitShellClauses } from "../audit/target";

/**
 * Understanding what a bash command *is*, so evidence collection can classify it.
 *
 * Everything here used to live inline in `evidence.ts` and operated on
 * `command.trim().split(/\s+/)` — the raw string's first token. That could not see
 * past a `cd`, a wrapper, or a package-manager script, so this repo's own
 * documented test command (`bun run test`, resolving to `vitest run`) was filed as
 * generic command evidence and could never satisfy a criterion requiring `test`.
 */

/** Binaries that ARE a test run when invoked bare. */
const DIRECT_TEST_RUNNERS = new Set([
  "vitest", "jest", "mocha", "bats", "pytest", "playwright",
]);

/** Binaries that are a test run only with a `test` subcommand (`go test`, `bun test`). */
const TEST_SUBCOMMAND_BINARIES = new Set(["cargo", "go", "bun", "node"]);

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/** Wrappers that execute the rest of the argv verbatim. */
const WRAPPERS = new Set(["npx", "bunx", "pnpx", "command", "time"]);

/**
 * Clause heads that never constitute the point of a command line. Used only to
 * pick the significant clause of a compound command — `cd sub && ls` is an `ls`.
 */
const NOISE_HEADS = new Set(["cd", "echo", "printf", "true", "false", ":", "export", "source", "."]);

const MAX_SCRIPT_DEPTH = 3;

export interface TestClassification {
  isTest: boolean;
  runner?: string;
}

/**
 * Normalized executable forms containing a space. `normalizeExecutable` emits
 * these, so anything validating an executable must accept them — a single-token
 * regex cannot. Kept here, beside the function that produces them, because the
 * contract schema and the deterministic contract previously carried their own
 * partial copies of this vocabulary and had drifted apart.
 */
export const MULTI_WORD_EXECUTABLES = new Set([
  "bun test", "go test", "cargo test", "node --test", "node test", "git grep",
  "npm test", "pnpm test", "yarn test",
]);

/**
 * Runner forms a test criterion should accept, spelled exactly as
 * `normalizeExecutable` emits them — `executableMatchesExpected` compares by
 * equality, so "bun" would never match a `bun test` run.
 */
export const KNOWN_TEST_EXECUTABLES = [
  "vitest", "jest", "mocha", "bats", "pytest", "playwright",
  "bun test", "go test", "cargo test", "node --test",
];

let cachedScripts: Record<string, string> | undefined;

/**
 * `package.json` scripts for the current repo, read once per process. Any failure
 * yields `{}` — evidence collection must never throw, and an unresolvable script
 * simply degrades to the pre-normalization behaviour.
 */
export function loadPackageScripts(cwd = process.cwd()): Record<string, string> {
  if (cachedScripts) return cachedScripts;
  try {
    const raw = readFileSync(join(cwd, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    const scripts: Record<string, string> = {};
    for (const [name, body] of Object.entries(parsed.scripts ?? {})) {
      if (typeof body === "string") scripts[name] = body;
    }
    cachedScripts = scripts;
  } catch {
    cachedScripts = {};
  }
  return cachedScripts;
}

/** Test-only: drop the memoized scripts so a fixture can be swapped in. */
export function resetPackageScriptsCache(): void {
  cachedScripts = undefined;
}

function tokenize(clause: string): string[] {
  return clause.trim().split(/\s+/).filter(Boolean);
}

/** Strip `FOO=bar`, `env`, and wrapper prefixes until a real executable is in front. */
function stripPrefixes(argv: string[]): string[] {
  let i = 0;
  while (i < argv.length) {
    const token = argv[i] ?? "";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || token === "env" || WRAPPERS.has(token)) {
      i += 1;
      continue;
    }
    break;
  }
  return argv.slice(i);
}

/**
 * The package.json script this argv delegates to, if any.
 *
 * `<pm> run <script>` resolves for every package manager. The implicit form
 * (`npm test` → `run test`) resolves for npm/pnpm/yarn only — **never for bun**,
 * because `bun test` invokes bun's own built-in test runner rather than the
 * package script, and conflating the two is exactly the mistake that makes this
 * repo report phantom failures.
 */
function scriptDelegation(
  argv: string[],
  scripts: Record<string, string>,
): { name: string; rest: string[] } | undefined {
  const cmd = argv[0] ?? "";
  if (!PACKAGE_MANAGERS.has(cmd)) return undefined;

  if (argv[1] === "run" && argv[2]) {
    return { name: argv[2], rest: argv.slice(3) };
  }
  if (cmd !== "bun" && argv[1] && scripts[argv[1]] !== undefined) {
    return { name: argv[1], rest: argv.slice(2) };
  }
  return undefined;
}

/**
 * Every clause of a command line, with package-manager script indirection
 * expanded. `bun run ci` ("typecheck && lint && test") yields all three resolved
 * clauses, so a test run buried inside an aggregate script is still visible.
 */
function expandClauses(
  command: string,
  scripts: Record<string, string>,
  depth: number,
  seen: Set<string>,
): string[][] {
  const out: string[][] = [];

  for (const clause of splitShellClauses(command)) {
    const argv = stripPrefixes(tokenize(clause));
    if (argv.length === 0) continue;

    const delegation = depth < MAX_SCRIPT_DEPTH ? scriptDelegation(argv, scripts) : undefined;
    const body = delegation ? scripts[delegation.name] : undefined;

    if (delegation && body !== undefined && !seen.has(delegation.name)) {
      seen.add(delegation.name);
      const inner = expandClauses(body, scripts, depth + 1, seen);
      // Trailing args belong to the last resolved clause: `bun run test --coverage`
      // is `vitest run --coverage`. A bare `--` separator carries no meaning here.
      const extra = delegation.rest.filter((token) => token !== "--");
      const last = inner[inner.length - 1];
      if (last && extra.length > 0) inner[inner.length - 1] = [...last, ...extra];
      out.push(...inner);
      continue;
    }

    out.push(argv);
  }

  return out;
}

/**
 * The one clause that characterises a command line.
 *
 * A test run anywhere wins — `cd sub && vitest run` and `vitest run && echo ok` are
 * both test runs, and picking positionally would lose one of them. Otherwise the
 * last clause that does something (navigation and echoes are not the point).
 */
function selectClause(clauses: string[][]): string[] {
  if (clauses.length === 0) return [];

  const test = clauses.find((argv) => classifyTestCommand(argv).isTest);
  if (test) return test;

  const meaningful = clauses.filter((argv) => !NOISE_HEADS.has(argv[0] ?? ""));
  return meaningful[meaningful.length - 1] ?? clauses[clauses.length - 1] ?? [];
}

/**
 * A raw bash command reduced to the argv that characterises it: wrappers stripped,
 * package scripts resolved, the significant clause of a compound command chosen.
 */
export function normalizeCommand(command: string, scripts?: Record<string, string>): string[] {
  return selectClause(expandClauses(command, scripts ?? loadPackageScripts(), 0, new Set()));
}

export function classifyTestCommand(argv: string[]): TestClassification {
  if (argv.length === 0) return { isTest: false };
  const cmd = argv[0] ?? "";

  if (DIRECT_TEST_RUNNERS.has(cmd)) return { isTest: true, runner: cmd };
  // `node --test` takes a flag, not a subcommand.
  if (cmd === "node" && argv.includes("--test")) return { isTest: true, runner: "node --test" };
  if (TEST_SUBCOMMAND_BINARIES.has(cmd) && argv[1] === "test") return { isTest: true, runner: `${cmd} test` };

  return { isTest: false };
}

export function normalizeExecutable(argv: string[]): string {
  if (argv.length === 0) return "unknown";
  const cmd = argv[0] ?? "unknown";
  const sub = argv[1] ?? "";

  if (TEST_SUBCOMMAND_BINARIES.has(cmd) && sub === "test") return `${cmd} test`;
  if (cmd === "node" && argv.includes("--test")) return "node --test";
  if (cmd === "git" && sub === "grep") return "git grep";

  return cmd;
}
