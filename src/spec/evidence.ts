import type { EvidenceRecord } from "./claims";
import { classifyTestCommand, normalizeCommand, normalizeExecutable } from "./command-normalize";
import { toRepoRelative } from "./repo-paths";
import { commandAuditTarget } from "../audit/target";

export type { EvidenceRecord } from "./claims";

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

/**
 * pi's edit/write schema names this parameter `path` (dist/core/tools/edit.js).
 * There is deliberately no `file_path` fallback — that is Claude Code's parameter
 * name, and accepting it here could only mask a genuine schema mismatch.
 */
function pathFromInput(input: Record<string, unknown> | undefined): string | undefined {
  const p = input?.path;
  return typeof p === "string" ? p : undefined;
}

export function evidenceFromToolResult(event: ToolResultEventLike): EvidenceRecord | undefined {
  const passed = event.isError !== true;

  if (event.toolName === "bash") {
    const command = typeof event.input?.command === "string" ? event.input.command : "";
    if (!command) return undefined;

    // The argv that characterises the command, not its first raw token: wrappers
    // stripped, package.json scripts resolved, the significant clause of a
    // compound command chosen. `bun run test` arrives here as `vitest run`.
    const argv = normalizeCommand(command);
    if (argv.length === 0) return undefined;
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

    // `family` was hardcoded "" while mustNotIsSatisfied interpolated it into the
    // text it matches against — commandAuditTarget already computes exactly this.
    const target = commandAuditTarget(command);
    return {
      kind: "command",
      family: target.kind === "bash-command" ? target.family ?? "" : "",
      normalizedExecutable: normalizeExecutable(argv),
      argv,
      exitCode: event.isError ? 1 : 0,
      passed,
    };
  }

  if (event.toolName === "edit" || event.toolName === "write") {
    const filePath = pathFromInput(event.input);
    if (!filePath) return undefined;
    // Stored repo-relative so it can bind to a contract target, which is always
    // repo-relative. A path outside the repo yields no evidence at all: it could
    // never match a target, so recording it would only add an unmatchable record.
    const repoPath = toRepoRelative(filePath);
    if (!repoPath) return undefined;
    return {
      kind: "diff",
      paths: [repoPath],
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
