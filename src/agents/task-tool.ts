import { spawn } from "node:child_process";
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
import { createWorktree, removeWorktree, generateWorktreeId, gcWorktrees, type Worktree } from "./worktree";

// ── Process-exit worktree cleanup ─────────────────────────────────────────────
// On SIGINT/SIGTERM, remove any worktrees this process owns before exiting.

let exitHandlersRegistered = false;
const activeWorktrees = new Map<string, { repoDir: string; worktree: Worktree }>();

function registerExitHandlers(): void {
  if (exitHandlersRegistered) return;
  exitHandlersRegistered = true;

  const cleanup = async (signal: NodeJS.Signals) => {
    for (const [, { repoDir, worktree }] of activeWorktrees) {
      removeWorktree(repoDir, worktree).catch((err) => {
        console.error(`[harness][worktree cleanup] Failed to remove ${worktree.path}:`, err instanceof Error ? err.message : String(err));
      });
    }
    activeWorktrees.clear();
    process.kill(process.pid, signal);
  };

  process.once("SIGINT",  () => { cleanup("SIGINT").catch(() => {}); });
  process.once("SIGTERM", () => { cleanup("SIGTERM").catch(() => {}); });
}

export async function runWorktreeGc(repoDir: string): Promise<Worktree[]> {
  return gcWorktrees(repoDir);
}
import {
  buildSubagentEnv,
  extractLatestAssistantText,
  getPiInvocation,
  resolveFinalText,
} from "./execution";

export { buildSubagentEnv, extractFinalText, extractLatestAssistantText, getPiInvocation, resolveFinalText } from "./execution";

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

export const TaskBatchItemSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  type: Type.Optional(Type.Union(AGENT_TYPES.map((t) => Type.Literal(t)))),
  goal: Type.String({ minLength: 1 }),
  context: Type.Optional(Type.String()),
});

export const TaskBatchParamsSchema = Type.Object({
  tasks: Type.Array(TaskBatchItemSchema, { minItems: 1 }),
});

export interface TaskParams {
  type?: AgentType;
  goal: string;
  context?: string;
}

export interface TaskRunResult {
  id?: string;
  type: AgentType;
  goal: string;
  text: string;
  ok: boolean;
  artifact?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskBatchItem {
  id: string;
  type?: AgentType;
  goal: string;
  context?: string;
}

type ResolvedTaskParams = Omit<TaskParams, "type"> & { type: AgentType };
type OnUpdate = (partial: { content: { type: "text"; text: string }[] }) => void;

export function formatTaskRunResult(result: TaskRunResult): TaskRunResult {
  return result;
}

export function validateTaskBatch(tasks: TaskBatchItem[]): void {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    seen.add(task.id);
  }
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
      registerExitHandlers();
      activeWorktrees.set(worktree.path, { repoDir, worktree });
    } catch {
      /* fall back: run in process.cwd() */
    }
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
        activeWorktrees.delete(worktree.path);
        removeWorktree(repoDir, worktree).catch((err) => {
          console.error(`[harness][worktree cleanup] Failed to remove ${worktree!.path}:`, err instanceof Error ? err.message : String(err));
        });
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
      const finalText = resolveFinalText({
        stdout,
        code,
        timedOut,
        timeoutMs: agent.timeoutMs,
      });
      const parsed = parseSubagentResult(finalText);
      writeTranscriptMetadata(path.join(process.cwd(), ".harness", "subagents"), {
        agentType: params.type,
        status: timedOut ? "timeout" : code === 0 || code === null ? "success" : "error",
        summary: parsed.text.slice(0, 500),
        startedAt,
        endedAt,
        metadata: parsed.metadata,
      }).catch(() => {});
      resolve(parsed.metadata ? JSON.stringify(parsed) : parsed.text);
    });
    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
  });
}
