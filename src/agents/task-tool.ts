// src/agents/task-tool.ts
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import type { HarnessPolicy } from "../policy/types";
import { AGENT_TYPES, type AgentType } from "./registry";
import { loadAgent } from "./loader";
import { narrowPolicyForAgent } from "./policy";
import { parseSubagentResult } from "./result";
import { writeTranscriptMetadata } from "./transcripts";
import { createWorktree, removeWorktree, generateWorktreeId, type Worktree } from "./worktree";

export const TaskParamsSchema = Type.Object({
  type: Type.Optional(
    Type.Union(
      AGENT_TYPES.map((t) => Type.Literal(t)),
      {
        description:
          "Specialist: ask (explain), plan (design), build (implement). Omit to let the user choose.",
      },
    ),
  ),
  goal: Type.String({
    minLength: 1,
    description: "What the subagent should accomplish",
  }),
  context: Type.Optional(
    Type.String({ description: "Optional file contents or snippets to pass down" }),
  ),
});

export interface TaskParams {
  type?: AgentType;
  goal: string;
  context?: string;
}

type ResolvedTaskParams = Omit<TaskParams, "type"> & { type: AgentType };

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
    } catch { continue; }
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
  } catch { /* not json */ }
  return null;
}

function getPiInvocation(args: string[]): { cmd: string; args: string[] } {
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

type OnUpdate = (partial: { content: { type: "text"; text: string }[] }) => void;

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

export async function executeTask(
  params: ResolvedTaskParams,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdate | undefined,
  parentPolicy?: HarnessPolicy,
): Promise<string> {
  const agent = await loadAgent(params.type);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "harness-subagent-"));

  const repoDir = process.cwd();
  let worktree: Worktree | undefined;
  if (params.type === "build") {
    try {
      worktree = await createWorktree(repoDir, generateWorktreeId());
    } catch { /* fall back: run in process.cwd() */ }
  }
  const promptFile = path.join(tmp, `${params.type}.md`);
  await fsp.writeFile(promptFile, agent.body, "utf-8");
  const policyFile = parentPolicy ? path.join(tmp, "harness.policy.json") : undefined;
  if (policyFile && parentPolicy) {
    const narrowed = narrowPolicyForAgent(params.type, parentPolicy);
    await fsp.writeFile(policyFile, JSON.stringify(narrowed), "utf-8");
  }

  const piArgs: string[] = ["--mode", "json", "-p", "--no-session"];
  if (agent.tools && agent.tools.length > 0) piArgs.push("--tools", agent.tools.join(","));
  if (agent.model) piArgs.push("--model", agent.model);
  piArgs.push("--append-system-prompt", promptFile);

  const taskMessage = params.context
    ? `## Context\n${params.context}\n\n## Task\n${params.goal}`
    : `Task: ${params.goal}`;
  const boundedTaskMessage = agent.maxTurns
    ? `${taskMessage}\n\nStop after at most ${agent.maxTurns} agent turns.`
    : taskMessage;
  piArgs.push(boundedTaskMessage);

  const { cmd, args } = getPiInvocation(piArgs);

  return new Promise<string>((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const child = spawn(cmd, args, {
      cwd: worktree?.path,
      env: buildSubagentEnv(params.type, parentPolicy, policyFile),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.resume();
    let timedOut = false;
    const timeoutId = agent.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, agent.timeoutMs)
      : undefined;

    const abortHandler = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abortHandler);

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortHandler);
      fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      if (worktree) {
        removeWorktree(repoDir, worktree).catch(() => {});
      }
    };

    let stdout = "";
    let buffer = "";

    child.stdout.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stdout += chunk;
      buffer += chunk;

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const text = extractLatestAssistantText(line);
        if (text) {
          onUpdate?.({ content: [{ type: "text", text }] });
        }
      }
    });

    child.on("close", (code) => {
      cleanup();
      const endedAt = new Date().toISOString();
      const finalText = timedOut
        ? `(subagent timed out after ${agent.timeoutMs}ms)`
        : code !== 0 && code !== null
          ? `(subagent exited with code ${code})`
          : extractFinalText(stdout);
      const parsed = parseSubagentResult(finalText);
      writeTranscriptMetadata(path.join(process.cwd(), ".harness", "subagents"), {
        agentType: params.type,
        status: timedOut ? "timeout" : code === 0 || code === null ? "success" : "error",
        summary: parsed.text.slice(0, 500),
        startedAt,
        endedAt,
        metadata: parsed.metadata,
      }).catch(() => {});
      resolve(parsed.text);
    });
    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
  });
}
