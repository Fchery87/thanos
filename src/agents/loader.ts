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

function agentDir(): string {
  return join(process.env.HOME ?? "~", ".pi", "agent", "agents");
}

function parseStringScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseToolsValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
      }
    } catch {
      // fall through to comma-separated parsing
    }
  }
  return trimmed.split(",").map((item) => parseStringScalar(item)).filter(Boolean);
}

function parsePositiveInteger(value: string, key: string): number {
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid agent frontmatter value for ${key}`);
  }
  return parsed;
}

function parseFrontmatter(raw: string): Partial<AgentDefinition> & { body: string } {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") return { body: raw };

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) return { body: raw };

  const frontmatter = lines.slice(1, closingIndex);
  const body = lines.slice(closingIndex + 1).join("\n");

  const parsed: Partial<AgentDefinition> = {};

  for (let i = 0; i < frontmatter.length; i++) {
    const line = frontmatter[i]!.trimEnd();
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1]!;
    const rawValue = match[2] ?? "";

    if (key === "tools") {
      if (!rawValue.trim()) {
        const tools: string[] = [];
        while (i + 1 < frontmatter.length && /^\s*-\s+/.test(frontmatter[i + 1]!)) {
          i += 1;
          const item = frontmatter[i]!.replace(/^\s*-\s+/, "").trim();
          if (item) tools.push(parseStringScalar(item));
        }
        if (tools.length > 0) parsed.tools = tools;
        continue;
      }
      parsed.tools = parseToolsValue(rawValue);
      continue;
    }

    if (key === "model") {
      const model = parseStringScalar(rawValue);
      if (model) parsed.model = model;
      continue;
    }

    if (key === "maxTurns") {
      parsed.maxTurns = parsePositiveInteger(rawValue, key);
      continue;
    }

    if (key === "timeoutMs") {
      parsed.timeoutMs = parsePositiveInteger(rawValue, key);
      continue;
    }
  }

  return { ...parsed, body };
}

export async function loadAgent(type: AgentType): Promise<AgentDefinition> {
  try {
    const raw = await readFile(join(agentDir(), `${type}.md`), "utf-8");
    return parseFrontmatter(raw);
  } catch {
    return { body: `You are a ${type} specialist. Complete the task given to you.` };
  }
}
