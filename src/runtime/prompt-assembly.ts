export interface SystemPromptInput {
  baseSystemPrompt: string;
  isSubagent: boolean;
  trustedInstructions: readonly string[];
  skillsDirective: string;
  roster: string; // session-static (roster.ts already freezes it)
  permissionMode?: string; // yolo is toggled explicitly, not per-turn → static block, not the tail
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
  const dynamicBlocks = [input.memoriesBlock, input.goalDirective].filter(Boolean) as string[];
  const dynamicMessage = dynamicBlocks.length ? dynamicBlocks.join("\n\n") : undefined;

  // Subagents keep Pi's base prompt untouched (no systemPrompt override), but a
  // directly-set goal directive must still ride along as the tail message —
  // returning {} here would silently drop it. Matches the "runs in parent and
  // subagent alike" intent documented at the goal-directive call site.
  if (input.isSubagent) {
    return dynamicMessage ? { dynamicMessage } : {};
  }

  const staticBlocks = [
    input.baseSystemPrompt,
    input.trustedInstructions.join("\n\n"),
    input.skillsDirective,
    input.roster,
    input.permissionMode,
  ].filter(Boolean);

  return {
    systemPrompt: staticBlocks.length ? staticBlocks.join("\n\n") : undefined,
    dynamicMessage,
  };
}
