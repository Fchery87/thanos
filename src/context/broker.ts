import type { MemoryRecord } from "../memory/types";
import { formatMemoriesForInjection } from "../memory/injector";
import { formatRoster, type RosterEntry } from "../agents/roster";
import { renderContextEnvelope } from "./render";
import { makeContextEnvelope } from "./envelope";

export interface PromptAssembly {
  trustedInstructions: string;
  contextMessage?: string;
  diagnostics: { truncated: number; dropped: number };
}

export function assemblePrompt(input: {
  isSubagent: boolean;
  memories?: MemoryRecord[];
  roster?: RosterEntry[];
  goalCondition?: string;
  trustedInstructions: string[];
}): PromptAssembly {
  const diagnostics = { truncated: 0, dropped: 0 };
  const contextBlocks: string[] = [];

  if (!input.isSubagent && input.memories) {
    const memoriesBlock = formatMemoriesForInjection(input.memories);
    if (memoriesBlock) {
      contextBlocks.push(renderContextEnvelope(makeContextEnvelope({
        id: "project-memories",
        origin: "memory",
        authority: "preference",
        trusted: false,
        content: memoriesBlock,
        maxBytes: 12_000,
      })));
    }
  }

  if (!input.isSubagent && input.roster) {
    const roster = formatRoster(input.roster);
    if (roster) {
      contextBlocks.push(renderContextEnvelope(makeContextEnvelope({
        id: "specialist-roster",
        origin: "project",
        authority: "request",
        trusted: false,
        content: roster,
        maxBytes: 12_000,
      })));
    }
  }

  if (input.goalCondition) {
    contextBlocks.push(renderContextEnvelope(makeContextEnvelope({
      id: "active-goal",
      origin: "harness",
      authority: "request",
      trusted: false,
      content: input.goalCondition,
      maxBytes: 12_000,
    })));
  }

  return {
    trustedInstructions: input.trustedInstructions.join("\n\n"),
    contextMessage: contextBlocks.length ? contextBlocks.join("\n\n") : undefined,
    diagnostics,
  };
}
