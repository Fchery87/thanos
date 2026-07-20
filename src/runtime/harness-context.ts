import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import { AuditLogger } from "../audit/logger";
import { PermissionManager } from "../permissions/manager";
import { gateDisabledByEnv, yoloDisabledByEnv } from "../permissions/yolo-config";
import { SpecEngine } from "../spec/engine";
import { buildContinuationPrompt, GATE_CONTINUE_SENTINEL, shouldReinject } from "../spec/gate";
import { GoalController } from "../goal/controller";
import { registerGoalCommand, renderGoalStatusSegment } from "../goal/command";
import { handleAgentEnd as handleGoalAgentEnd } from "../goal/loop";
import { readAborted, readWillRetry } from "../goal/extract";
import { GOAL_DIRECTIVE_SENTINEL, buildGoalSystemPrompt } from "../goal/prompts";
import { loadEvaluatorOverride, loadGoalSettings } from "../goal/load-settings";
import { pickEvaluatorModel, resolveEvaluatorAuth } from "../goal/evaluator-model";
import { resolveGoalSettings } from "../goal/types";
import { makeAfterToolHandler } from "../hooks/after-tool";
import type { TaskParams } from "../agents/task-tool";
import { AGENT_TYPES } from "../agents/registry";
import { loadPolicyState } from "../policy/state";
import { loadRegistry, readRepoId, resolveDeliveryState } from "../governance/delivery";
import type { DeliveryMode, ResolvedDelivery } from "../governance/delivery";
import { deliveryPolicyOverlay } from "../governance/delivery-overlay";
import { DELIVERY_MODE_HELP, DELIVERY_MODES, saveRegistry, upsertRegistryEntry } from "../governance/delivery-select";
import { shouldBlockLocalOnlyPush } from "../governance/push-guard";
import { fastForwardMerge, getCurrentBranch } from "../governance/ff-merge";
import type { FormalSpec } from "../spec/types";
import { registerSlashCommands } from "../commands/slash";
import { MCPManager } from "../mcp/manager";
import { loadMcpConfigs, mcpConfigPaths } from "../mcp/config";
import { writeServerSecrets, readServerSecrets } from "../mcp/state";
import { runOAuthFlow, probeOAuth, fetchOAuthMeta } from "../mcp/oauth";
import {
  connectMcpServer, disableMcpServer, disconnectMcpServer,
  enableMcpServer, initializeMcpSession, reloadMcpSession,
} from "../mcp/lifecycle";
import {
  DEFAULT_PICKER_LABEL_WIDTH, fitTerminalText, fixedWidthTerminalText,
  formatLabel, formatValue, formatSpecForApproval, formatPanel,
  makeTerminalSafeOptions, noopTheme, stripAnsi,
} from "../ui-utils";
import { renderAuditPanel, renderPolicyPanel, renderSessionSnapshotPanel, renderSpecVerificationPanel } from "../commands/presenters";
import { renderWelcomeHeader, formatTimeAgo, type WelcomeMcpSummary, type WelcomePolicySummary } from "../welcome/header";
import { checkForUpdate } from "../welcome/update-check";
import { checkPatchDrift, formatPatchDriftWarning } from "../welcome/patch-drift";
import { MemoryStore, MAX_MEMORY_LENGTH } from "../memory/store";
import { formatMemoriesForInjection } from "../memory/injector";
import { createSnapshot } from "../security/snapshot";
import { evaluateGovernedToolCall } from "../governance/tool-call";
import { AskParamsSchema, buildAskDecision, resolveHeadlessAsk, type AskQuestion } from "../interaction/ask";
import {
  createTodoState, applyTodoOperation, exportTodoMarkdown, reconstructTodoState,
  makeTodoDetails, EMPTY_TODO_STATE, TodoParamsSchema,
  type TodoOperation, type TodoState, type TodoDetails,
} from "../interaction/todo";
import { renderTodoLines, todoSummary } from "../interaction/todo-render";
import { FindingParamsSchema, addFinding, formatReviewSummary, type ReviewFinding } from "../review/findings";
import { buildJuryPrompt } from "../review/jury";
import { LensLite, registerLensLiteCommand } from "../lens/lite";
import { appendHarnessEvent } from "../observability/harness-ledger";
import { detectChildRole, isSubagentProcess } from "../agents/child-role";
import { roleNarrowingOverlay } from "../governance/role-overlay";
import { GovernanceRuntime, type GovernanceContext } from "../runtime/governance-runtime";
import { ContinuationArbiter } from "../runtime/continuation-arbiter";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "off      — no reasoning", minimal: "minimal  — ~1k tokens",
  low: "low      — ~2k tokens", medium: "medium   — ~8k tokens",
  high: "high     — ~16k tokens", xhigh: "xhigh    — ~32k tokens",
};

function getSupportedLevels(model: { reasoning: boolean; thinkingLevelMap?: Partial<Record<string, string | null>> }): ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  return ALL_THINKING_LEVELS.filter((level) => model.thinkingLevelMap?.[level] !== null);
}

function formatGateNames(gates: Record<string, string | null>): string {
  const names = Object.keys(gates);
  return names.length > 0 ? names.join(", ") : "none";
}

function setThinkingStatus(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const level = pi.getThinkingLevel() as ThinkingLevel | undefined;
  ctx.ui.setStatus("harness-thinking", level && level !== "off" ? ctx.ui.theme.fg("accent", `thinking:${level}`) : undefined);
}

const CTX_EXEC_TOOLS = new Set(["ctx_execute", "ctx_execute_file", "ctx_batch_execute"]);
const CTX_EXEC_MAX_TIMEOUT_MS = 110_000;

function contextModeExecutionGuard(event: { toolName?: string; input?: unknown }): { block: true; reason: string } | undefined {
  const toolName = event.toolName ?? "";
  if (!CTX_EXEC_TOOLS.has(toolName)) return undefined;
  const input = event.input && typeof event.input === "object" ? event.input as Record<string, unknown> : {};
  const timeout = Number(input.timeout);
  const hasTimeout = input.timeout !== undefined && Number.isFinite(timeout) && timeout > 0;
  if (!hasTimeout) {
    return { block: true, reason: `${toolName} was called without an explicit timeout.` };
  }
  if (timeout > CTX_EXEC_MAX_TIMEOUT_MS) {
    return { block: true, reason: `${toolName} timeout ${timeout}ms exceeds the safe Pi bridge budget.` };
  }
  return undefined;
}

/** Shared state passed to all registration helpers. */
export interface HarnessContext {
  permissions: PermissionManager;
  spec: SpecEngine;
  goalController: GoalController;
  lens: LensLite;
  policyStatePromise: Promise<any>;
  deliveryStatePromise: Promise<ResolvedDelivery | undefined>;
  deliveryOverlayPromise: Promise<any[]>;
  isSubagent: boolean;
  childRole: string | undefined;
  sessionId: string;
  agentType: "parent" | "subagent";
  defaultTaskType: any;
  todoState: TodoState;
  reviewFindings: ReviewFinding[];
  mcpManager: MCPManager | null;
  recordGoalEvent: (e: any) => Promise<void>;
  requirePolicy: (ctx: ExtensionContext) => Promise<any>;
  pi: ExtensionAPI;
  deps: { initialYolo?: boolean } | undefined;
  _applyDelivery: (ctx: ExtensionContext, mode: DeliveryMode) => Promise<void>;
  _promptDelivery: (ctx: ExtensionContext, label: string) => Promise<DeliveryMode | undefined>;
  _deliveryLabel: (d: ResolvedDelivery) => string;
}
