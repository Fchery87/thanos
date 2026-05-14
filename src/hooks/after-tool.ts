import type { SpecEngine } from "../spec/engine";
import type { EvidenceRecord, EvidenceType } from "../spec/evidence";

type TextPart = { type: string; text?: string };

interface ToolResultEventLike {
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

function evidenceFromToolResult(event: ToolResultEventLike): EvidenceRecord | undefined {
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

export function makeAfterToolHandler(spec: SpecEngine) {
  return async (event: ToolResultEventLike): Promise<void> => {
    if (spec.activeSpec) {
      const evidence = evidenceFromToolResult(event);
      if (evidence) spec.recordEvidence(evidence);
    }
  };
}
