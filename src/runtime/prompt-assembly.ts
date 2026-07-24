export interface SystemPromptInput {
  baseSystemPrompt: string;
  isSubagent: boolean;
  trustedInstructions: readonly string[];
  skillsDirective: string;
  roster: string; // session-static (roster.ts already freezes it)
  memoriesBlock?: string; // per-turn dynamic → tail message
  goalDirective?: string; // per-turn dynamic → tail message
}

export interface AssembledPrompt {
  /** undefined = keep Pi's base prompt (subagents, or nothing to add). */
  systemPrompt?: string;
  /** Rendered dynamic context for a custom tail message, or undefined. */
  dynamicMessage?: string;
}

export function assembleSystemPrompt(input: SystemPromptInput): AssembledPrompt {
  if (input.isSubagent) return {};

  const staticBlocks = [
    input.baseSystemPrompt,
    input.trustedInstructions.join("\n\n"),
    input.skillsDirective,
    input.roster,
  ].filter(Boolean);

  const dynamicBlocks = [input.memoriesBlock, input.goalDirective].filter(Boolean) as string[];

  return {
    systemPrompt: staticBlocks.length ? staticBlocks.join("\n\n") : undefined,
    dynamicMessage: dynamicBlocks.length ? dynamicBlocks.join("\n\n") : undefined,
  };
}
