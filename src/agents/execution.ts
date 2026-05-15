import * as fs from "node:fs";
import * as path from "node:path";
import type { HarnessPolicy } from "../policy/types";
import type { AgentType } from "./registry";

export function extractFinalText(stdout: string): string {
  const lines = stdout.split("\n").reverse();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === "agent_end" && Array.isArray(ev.messages)) {
        for (let i = ev.messages.length - 1; i >= 0; i--) {
          const msg = ev.messages[i];
          if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "text" && part.text) return part.text as string;
            }
          }
        }
      }
    } catch {
      continue;
    }
  }
  return "(no output)";
}

export function extractLatestAssistantText(line: string): string | null {
  try {
    const ev = JSON.parse(line);
    if (ev.type !== "message_end" || ev.message?.role !== "assistant") return null;
    for (const part of ev.message.content ?? []) {
      if (part.type === "text" && part.text) return part.text as string;
    }
  } catch {
    /* not json */
  }
  return null;
}

export function getPiInvocation(args: string[]): { cmd: string; args: string[] } {
  const script = process.argv[1];
  const isBunVirtual = script?.startsWith("/$bunfs/root/");
  if (script && !isBunVirtual && fs.existsSync(script)) {
    return { cmd: process.execPath, args: [script, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName)) {
    return { cmd: process.execPath, args };
  }
  return { cmd: "pi", args };
}

export function buildSubagentEnv(
  type: AgentType,
  _policy: HarnessPolicy | undefined,
  policyFile: string | undefined,
): NodeJS.ProcessEnv {
  // reviewer gets its own role value so its process can register the task tool
  // (restricted to spawning explore agents only). All other agent types get "1"
  // which marks them as leaf agents that cannot spawn further.
  const role = type === "reviewer" ? "reviewer" : "1";
  return {
    ...process.env,
    HARNESS_SUBAGENT: role,
    ...(policyFile ? { HARNESS_POLICY_FILE: policyFile } : {}),
  };
}

export function resolveFinalText(options: {
  stdout: string;
  code: number | null;
  timedOut: boolean;
  timeoutMs?: number;
}): string {
  if (options.timedOut) {
    return `(subagent timed out after ${options.timeoutMs}ms)`;
  }
  if (options.code !== 0 && options.code !== null) {
    return `(subagent exited with code ${options.code})`;
  }
  return extractFinalText(options.stdout);
}
