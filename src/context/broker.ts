import type { MemoryRecord } from "../memory/types";
import { formatMemoriesForInjection } from "../memory/injector";
import { renderContextEnvelope } from "./render";
import { makeContextEnvelope } from "./envelope";

export interface PromptAssembly {
  /** Rendered memory envelope, or undefined if there's nothing to inject. */
  memoriesMessage?: string;
}

/**
 * Renders the memory envelope for injection into the dynamic (uncached) tail
 * message. Roster and goal-condition rendering moved out of this function:
 * roster now goes straight through `formatRoster` into `assembleSystemPrompt`'s
 * static `roster` block, and the goal condition is rendered by
 * `buildGoalSystemPrompt`/`goalDirective` — neither belongs in the
 * per-turn-dynamic memories envelope, so keeping them here would just be
 * dead branches wearing a "prompt assembly" name.
 */
export function assemblePrompt(input: {
  isSubagent: boolean;
  memories?: MemoryRecord[];
}): PromptAssembly {
  if (input.isSubagent || !input.memories) return {};

  const memoriesBlock = formatMemoriesForInjection(input.memories);
  if (!memoriesBlock) return {};

  return {
    memoriesMessage: renderContextEnvelope(makeContextEnvelope({
      id: "project-memories",
      origin: "memory",
      authority: "preference",
      trusted: false,
      content: memoriesBlock,
      maxBytes: 12_000,
    })),
  };
}
