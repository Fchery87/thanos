import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { HarnessPolicy } from "../policy/types";
import type { AgentType } from "./registry";
import { resolveContextMode, buildContextArgs } from "./context-mode";
import { agentWrites, narrowPolicyForAgent } from "./policy";
import { parseSubagentResult } from "./result";
import type { SubagentResultContract } from "./result";
import type { RunStore } from "./run-store";
import { type RunState } from "./run-store";
import { executeProcess, type ProcessResult, type RunOutcome } from "./process";
import { createWorktree, removeWorktree, generateWorktreeId } from "./worktree";
import {
  buildSubagentEnv,
  getPiInvocation,
  resolveFinalText,
} from "./execution";
import { captureChanges, writeHandoffPatch, type ChangeHandoff } from "./change-handoff";
import { loadAgent } from "./loader";

export type { RunState } from "./run-store";

export interface AgentRunRequest {
  type: AgentType;
  goal: string;
  context?: string;
  background?: boolean;
  parentPolicy?: HarnessPolicy;
  parentSessionRef?: string;
  writeScope?: string[];
}

export interface AgentRunHandle {
  id: string;
  state: RunState;
  resultPath: string;
}

export interface AgentRunResult {
  id: string;
  type: AgentType;
  goal: string;
  contract: SubagentResultContract;
  handoff?: ChangeHandoff;
  processResult: ProcessResult;
}

async function executeAgentRun(
  runId: string,
  request: Required<Pick<AgentRunRequest, "type" | "goal">> & Omit<AgentRunRequest, "type" | "goal">,
  store: RunStore,
  signal?: AbortSignal,
  _onUpdate?: (text: string) => void,
): Promise<AgentRunResult> {
  const agent = await loadAgent(request.type);
  const contextMode = resolveContextMode(request.type, agent.context);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "harness-run-"));

  const repoDir = process.cwd();
  let worktreePath: string | undefined;

  if (agentWrites(request.type)) {
    const id = generateWorktreeId();
    const worktree = await createWorktree(repoDir, id);
    worktreePath = worktree.path;
  }

  const promptFile = path.join(tmp, `${request.type}.md`);
  await fsp.writeFile(promptFile, agent.body, "utf-8");

  let policyFile: string | undefined;
  if (request.parentPolicy) {
    const narrowed = narrowPolicyForAgent(request.type, request.parentPolicy);
    policyFile = path.join(tmp, "harness.policy.json");
    await fsp.writeFile(policyFile, JSON.stringify(narrowed), "utf-8");
  }

  const piArgs: string[] = ["--mode", "json", "-p", ...buildContextArgs(contextMode, request.parentSessionRef)];
  if (agent.tools && agent.tools.length > 0) piArgs.push("--tools", agent.tools.join(","));
  if (agent.model) piArgs.push("--model", agent.model);
  piArgs.push("--append-system-prompt", promptFile);

  const taskMessage = request.context
    ? `## Context\n${request.context}\n\n## Task\n${request.goal}`
    : `Task: ${request.goal}`;
  const boundedTaskMessage = agent.maxTurns
    ? `${taskMessage}\n\nStop after at most ${agent.maxTurns} agent turns.`
    : taskMessage;
  piArgs.push(boundedTaskMessage);

  const { cmd, args } = getPiInvocation(piArgs);

  const processResult = await executeProcess({
    cmd,
    args,
    cwd: worktreePath,
    env: buildSubagentEnv(request.type, request.parentPolicy, policyFile),
    timeoutMs: agent.maxExecutionTimeMs,
    signal,
  });

  const finalText = resolveFinalText({
    stdout: processResult.stdout,
    code: processResult.exitCode,
    timedOut: processResult.outcome === "timeout",
    timeoutMs: agent.maxExecutionTimeMs,
  });

  const contract = parseSubagentResult(finalText);

  if (processResult.outcome !== "completed") {
    const outcomeToStatus: Record<RunOutcome, SubagentResultContract["status"]> = {
      completed: "success",
      cancelled: "error",
      timeout: "timeout",
      process_error: "error",
      invalid_result: "error",
    };
    contract.status = outcomeToStatus[processResult.outcome] ?? "error";
  }

  let handoff: ChangeHandoff | undefined;
  if (worktreePath && agentWrites(request.type)) {
    const capture = await captureChanges(repoDir, worktreePath, request.writeScope);
    if (capture.kind === "ok") {
      handoff = capture.handoff;
      await writeHandoffPatch(store.runDir, runId, capture.handoff);
      handoff.patch = capture.handoff.patch;
    } else if (capture.kind === "failure") {
      contract.metadata = { ...(contract.metadata ?? {}), handoffFailure: capture.reason };
    }
  }

  // Cleanup worktree
  if (worktreePath) {
    try {
      if (handoff) {
        await removeWorktree(repoDir, { path: worktreePath, branch: `harness/wt-${runId}` });
      } // else: keep worktree for recovery
    } catch {
      // best effort
    }
  }

  // Cleanup temp
  fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});

  return {
    id: runId,
    type: request.type,
    goal: request.goal,
    contract,
    handoff,
    processResult,
  };
}

export async function startAgentRun(
  request: AgentRunRequest,
  store: RunStore,
  signal?: AbortSignal,
  onUpdate?: (text: string) => void,
): Promise<AgentRunResult> {
  const runId = generateWorktreeId();

  await store.create(runId, {
    id: runId,
    agentType: request.type,
    goal: request.goal,
    contextMode: resolveContextMode(request.type, undefined),
  });

  await store.transition(runId, "running");

  let result: AgentRunResult;
  try {
    result = await executeAgentRun(runId, request, store, signal, onUpdate);
  } catch (err) {
    await store.transition(runId, "failed").catch(() => {});
    const errorContract: SubagentResultContract = {
      version: 1,
      status: "error",
      summary: err instanceof Error ? err.message : String(err),
      findings: [],
      artifacts: [],
      escalations: [],
    };
    await store.writeResult(runId, errorContract).catch(() => {});
    return {
      id: runId,
      type: request.type,
      goal: request.goal,
      contract: errorContract,
      processResult: { outcome: "process_error", exitCode: null, stdout: "", stderr: "", durationMs: 0 },
    };
  }

  const terminalState: RunState =
    result.contract.status === "timeout" ? "timeout"
    : result.contract.status === "error" ? "failed"
    : "completed";

  await store.transition(runId, terminalState).catch(() => {});
  await store.writeResult(runId, result.contract).catch(() => {});

  return result;
}

export async function startBackgroundRun(
  request: AgentRunRequest & { type: AgentType },
  store: RunStore,
): Promise<AgentRunHandle> {
  const runId = generateWorktreeId();

  await store.create(runId, {
    id: runId,
    agentType: request.type,
    goal: request.goal,
    contextMode: resolveContextMode(request.type, undefined),
  });

  await store.transition(runId, "running");

  executeAgentRun(runId, request, store)
    .then(async (result) => {
      const terminalState: RunState =
        result.contract.status === "timeout" ? "timeout"
        : result.contract.status === "error" ? "failed"
        : "completed";
      await store.transition(runId, terminalState).catch(() => {});
      await store.writeResult(runId, result.contract).catch(() => {});
    })
    .catch(async () => {
      await store.transition(runId, "failed").catch(() => {});
    });

  return {
    id: runId,
    state: "running",
    resultPath: `.harness/subagents/${runId}/result.json`,
  };
}
