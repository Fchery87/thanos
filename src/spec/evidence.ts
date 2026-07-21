import type { EvidenceRecord } from "./claims";

export type { EvidenceRecord } from "./claims";

const KNOWN_TEST_RUNNERS = new Set([
  "vitest", "jest", "mocha", "bats", "pytest", "playwright",
  "cargo test", "go test", "bun test", "node --test",
]);

const KNOWN_RUNNER_BINARIES = new Set([
  "vitest", "jest", "mocha", "pytest", "playwright", "bats",
  "cargo", "go", "bun", "node",
]);

type TextPart = { type: string; text?: string };

export interface ToolResultEventLike {
  type?: string;
  toolCallId?: string;
  toolName: string;
  input?: Record<string, unknown>;
  content?: TextPart[];
  details?: unknown;
  isError?: boolean;
  output?: string;
}

function textFromContent(content: TextPart[] | undefined): string {
  return content
    ?.filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim() ?? "";
}

function pathFromInput(input: Record<string, unknown> | undefined): string | undefined {
  const p = input?.path ?? input?.file_path;
  return typeof p === "string" ? p : undefined;
}

function classifyTestCommand(argv: string[]): { isTest: boolean; runner?: string } {
  if (argv.length === 0) return { isTest: false };
  const cmd = argv[0] ?? "";

  if (KNOWN_TEST_RUNNERS.has(cmd)) {
    return { isTest: true, runner: cmd };
  }

  if (KNOWN_RUNNER_BINARIES.has(cmd)) {
    const subCmd = argv[1] ?? "";
    if (subCmd === "test") {
      return { isTest: true, runner: `${cmd} test` };
    }
  }

  return { isTest: false };
}

function normalizeExecutable(argv: string[]): string {
  if (argv.length === 0) return "unknown";
  const cmd = argv[0] ?? "unknown";
  const sub = argv[1] ?? "";
  if ((cmd === "bun" || cmd === "node" || cmd === "cargo" || cmd === "go") && sub === "test") {
    return `${cmd} test`;
  }
  if (cmd === "git" && sub === "grep") {
    return "git grep";
  }
  return cmd;
}

export function evidenceFromToolResult(event: ToolResultEventLike): EvidenceRecord | undefined {
  const passed = event.isError !== true;

  if (event.toolName === "bash") {
    const command = typeof event.input?.command === "string" ? event.input.command : "";
    if (!command) return undefined;

    const argv = command.trim().split(/\s+/);
    const { isTest, runner } = classifyTestCommand(argv);

    if (isTest) {
      return {
        kind: "test",
        runner: runner ?? "unknown",
        normalizedExecutable: normalizeExecutable(argv),
        args: argv.slice(1),
        exitCode: event.isError ? 1 : 0,
        passed,
      };
    }

    return {
      kind: "command",
      family: "",
      normalizedExecutable: normalizeExecutable(argv),
      argv,
      exitCode: event.isError ? 1 : 0,
      passed,
    };
  }

  if (event.toolName === "edit" || event.toolName === "write") {
    const filePath = pathFromInput(event.input);
    if (!filePath) return undefined;
    return {
      kind: "diff",
      paths: [filePath],
      base: "",
      patchHash: "",
      passed,
    };
  }

  return undefined;
}

export function safeInteractionMetadata(event: ToolResultEventLike): Record<string, unknown> | undefined {
  const output = textFromContent(event.content) || event.output?.trim() || "";
  if (!output) return undefined;

  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (event.toolName === "ask") {
      return {
        ...(typeof parsed.question === "string" ? { question: parsed.question } : {}),
        ...(Array.isArray(parsed.options) ? { options: parsed.options } : {}),
        ...(Array.isArray(parsed.selected) ? { selected: parsed.selected } : {}),
        ...(typeof parsed.recommended === "string" ? { recommended: parsed.recommended } : {}),
        ...(typeof parsed.source === "string" ? { source: parsed.source } : {}),
        ...(typeof parsed.rationale === "string" ? { rationale: parsed.rationale } : {}),
      };
    }

    if (event.toolName === "report_finding") {
      return {
        ...(typeof parsed.priority === "string" ? { priority: parsed.priority } : {}),
        ...(typeof parsed.summary === "string" ? { summary: parsed.summary } : {}),
        ...(typeof parsed.verdict === "string" ? { verdict: parsed.verdict } : {}),
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}
