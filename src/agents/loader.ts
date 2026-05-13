import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentType } from "./registry";

export interface AgentDefinition {
  body: string;
  tools?: string[];
  model?: string;
  maxTurns?: number;
  timeoutMs?: number;
}

const AGENT_DIR = join(process.env.HOME ?? "~", ".pi", "agent", "agents");

export async function loadAgent(type: AgentType): Promise<AgentDefinition> {
  try {
    const body = await readFile(join(AGENT_DIR, `${type}.md`), "utf-8");
    return { body };
  } catch {
    return { body: `You are a ${type} specialist. Complete the task given to you.` };
  }
}
