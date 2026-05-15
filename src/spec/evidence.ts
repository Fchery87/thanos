import type { EvidenceRequirement } from "./types";

export type EvidenceType = EvidenceRequirement;

export interface EvidenceRecord {
  type: EvidenceType;
  source: string;
  summary: string;
  passed: boolean;
  filePath?: string;
  commandFamily?: string;
}

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
  const path = input?.path ?? input?.file_path;
  return typeof path === "string" ? path : undefined;
}

function commandFamily(command: string): EvidenceType {
  return /\b(test|vitest|pytest|playwright|bats)\b/.test(command) ? "test" : "command";
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

export function evidenceFromToolResult(event: ToolResultEventLike): EvidenceRecord | undefined {
  const passed = event.isError !== true;
  const output = textFromContent(event.content) || event.output?.trim() || "";

  if (event.toolName === "bash") {
    const command = String(event.input?.command ?? "bash");
    const type = commandFamily(command);
    return {
      type,
      source: "bash",
      summary: `${command} ${passed ? "passed" : "failed"}`,
      passed,
      commandFamily: type,
    };
  }

  if (event.toolName === "edit" || event.toolName === "write") {
    const filePath = pathFromInput(event.input) ?? event.toolName;
    return {
      type: "diff",
      source: event.toolName,
      summary: `${event.toolName} changed ${filePath}`,
      passed,
      filePath,
    };
  }

  if (!output) return undefined;
  return { type: "manual", source: event.toolName, summary: output.slice(0, 200), passed };
}
