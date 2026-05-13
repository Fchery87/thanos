import type { AgentType } from "./registry";
import { AGENT_TYPES } from "./registry";

type UI = { select: (title: string, options: string[]) => Promise<string | undefined> };

export async function chooseTaskType(hasUI: boolean, ui: UI): Promise<AgentType | undefined> {
  if (!hasUI) return undefined;
  const selected = await ui.select("Choose a specialist", AGENT_TYPES);
  return (selected as AgentType | undefined) ?? undefined;
}
