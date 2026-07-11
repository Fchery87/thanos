// src/index.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { join } from "node:path";

import { AuditLogger } from "./audit/logger";
import type { AuditEvent } from "./audit/types";
import { PermissionManager } from "./permissions/manager";
import { gateDisabledByEnv, yoloDisabledByEnv } from "./permissions/yolo-config";
import { SpecEngine } from "./spec/engine";
import { buildContinuationPrompt, GATE_CONTINUE_SENTINEL, shouldReinject } from "./spec/gate";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { GoalController } from "./goal/controller";
import { registerGoalCommand, renderGoalStatusSegment } from "./goal/command";
import { handleAgentEnd as handleGoalAgentEnd } from "./goal/loop";
import { extractLastTurnFromBranch, readAborted, readWillRetry } from "./goal/extract";
import { runEvaluatorWith } from "./goal/evaluator";
import { GOAL_DIRECTIVE_SENTINEL, buildGoalSystemPrompt } from "./goal/prompts";
import { confirmGoalCompletion } from "./goal/confirm";
import { loadEvaluatorOverride, loadGoalSettings } from "./goal/load-settings";
import { pickEvaluatorModel } from "./goal/evaluator-model";
import { resolveGoalSettings } from "./goal/types";
import { makeBeforeToolHandler } from "./hooks/before-tool";
import { makeAfterToolHandler } from "./hooks/after-tool";
import { TaskParamsSchema, executeTask, needsClarification, parseSubagentResult, type TaskParams } from "./agents/task-tool";
import { AGENT_TYPES } from "./agents/registry";
import { loadPolicyState } from "./policy/state";
import { resolveDeliveryState } from "./governance/delivery";
import { deliveryPolicyOverlay } from "./governance/delivery-overlay";
import { shouldBlockLocalOnlyPush } from "./governance/push-guard";
import { fastForwardMerge, getCurrentBranch } from "./governance/ff-merge";
import type { FormalSpec } from "./spec/types";
import { chooseTaskType } from "./agents/selector";
import { registerSlashCommands } from "./commands/slash";
import { MCPManager } from "./mcp/manager";
import { loadMcpConfigs, mcpConfigPaths } from "./mcp/config";
import { writeServerSecrets, readServerSecrets } from "./mcp/state";
import { runOAuthFlow, probeOAuth, fetchOAuthMeta } from "./mcp/oauth";
import {
  connectMcpServer,
  disableMcpServer,
  disconnectMcpServer,
  enableMcpServer,
  initializeMcpSession,
  reloadMcpSession,
} from "./mcp/lifecycle";
import {
  DEFAULT_PICKER_LABEL_WIDTH,
  fitTerminalText,
  fixedWidthTerminalText,
  formatLabel,
  formatValue,
  formatSpecForApproval,
  formatPanel,
  makeTerminalSafeOptions,
  noopTheme,
  stripAnsi,
} from "./ui-utils";
import { renderAuditPanel, renderPolicyPanel, renderSessionSnapshotPanel, renderSpecVerificationPanel } from "./commands/presenters";
import { renderWelcomeHeader, formatTimeAgo, type WelcomeMcpSummary, type WelcomePolicySummary } from "./welcome/header";
import { checkForUpdate } from "./welcome/update-check";
import { MemoryStore, MAX_MEMORY_LENGTH } from "./memory/store";
import { formatMemoriesForInjection } from "./memory/injector";
// Model router removed — use /models command or pi-subagents for model selection
import { createSnapshot } from "./security/snapshot";
import { evaluateGovernedToolCall } from "./governance/tool-call";
// registerSearchTool removed — superseded by npm:pi-web-access
import { AskParamsSchema, buildAskDecision, resolveHeadlessAsk, type AskQuestion } from "./interaction/ask";
import {
  createTodoState, applyTodoOperation, exportTodoMarkdown, reconstructTodoState,
  makeTodoDetails, EMPTY_TODO_STATE, TodoParamsSchema,
  type TodoOperation, type TodoState, type TodoDetails,
} from "./interaction/todo";
import { renderTodoLines, todoSummary } from "./interaction/todo-render";
import { FindingParamsSchema, addFinding, formatReviewSummary, type ReviewFinding } from "./review/findings";
import { buildJuryPrompt } from "./review/jury";
import { LensLite, registerLensLiteCommand } from "./lens/lite";
import { appendHarnessEvent } from "./observability/harness-ledger";


type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off:     "off      — no reasoning",
  minimal: "minimal  — ~1k tokens",
  low:     "low      — ~2k tokens",
  medium:  "medium   — ~8k tokens",
  high:    "high     — ~16k tokens",
  xhigh:   "xhigh    — ~32k tokens",
};

function getSupportedLevels(model: { reasoning: boolean; thinkingLevelMap?: Partial<Record<string, string | null>> }): ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  return ALL_THINKING_LEVELS.filter((level) => model.thinkingLevelMap?.[level] !== null);
}

/** Human-readable list of gate names for /ship prompts ("none" when empty). */
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
    return {
      block: true,
      reason:
        `${toolName} was called without an explicit timeout. Context-mode's Pi bridge has a hard 120s tools/call ceiling; unbounded calls can freeze and fail with ` +
        `"MCP request timeout after 120000ms". Retry with a timeout <= ${CTX_EXEC_MAX_TIMEOUT_MS}ms. Suggested defaults: 10000ms for quick inspection, 30000ms for searches, 60000-90000ms for tests/builds. For servers/daemons, use background:true with a short timeout.`,
    };
  }

  if (timeout > CTX_EXEC_MAX_TIMEOUT_MS) {
    return {
      block: true,
      reason:
        `${toolName} timeout ${timeout}ms exceeds the safe Pi bridge budget. Retry with timeout <= ${CTX_EXEC_MAX_TIMEOUT_MS}ms, or use background:true with a short timeout for long-running processes.`,
    };
  }

  return undefined;
}


export default function register(pi: ExtensionAPI, deps?: { executeTask?: typeof executeTask; initialYolo?: boolean }) {
  const _executeTask = deps?.executeTask ?? executeTask;
  const subagentRole = process.env.HARNESS_SUBAGENT; // undefined | "1" | "reviewer"
  // PI_SUBAGENT_CHILD is set by the pi-subagents engine for every child it
  // spawns. Without checking it, children get the parent-only delegation
  // directive and recursively re-delegate (a reviewer spawning a reviewer)
  // instead of doing their own work, idling until their budget kills them.
  const isSubagent = !!subagentRole || process.env.PI_SUBAGENT_CHILD === "1";
  const isReviewer = subagentRole === "reviewer";
  const sessionId = crypto.randomUUID();
  const agentType = isSubagent ? "subagent" : "parent" as const;
  let defaultTaskType: TaskParams["type"] | undefined;
  let todoState: TodoState = createTodoState([]);

  function todoStatusSegment(ctx: ExtensionContext, state: TodoState): string | undefined {
    const s = todoSummary(state);
    return s ? ctx.ui.theme.fg("accent", s) : undefined;
  }
  let reviewFindings: ReviewFinding[] = [];
  const lens = new LensLite(sessionId);

  const permissions = new PermissionManager();
  if (deps?.initialYolo !== undefined) {
    permissions.setYolo(deps.initialYolo);
  }
  if (yoloDisabledByEnv()) permissions.lockYolo();
  const spec = new SpecEngine();
  const goalSettings = resolveGoalSettings(loadGoalSettings());
  const goalController = new GoalController(goalSettings);
  const policyStatePromise = loadPolicyState(process.cwd(), process.env.HARNESS_POLICY_FILE);
  // Resolved in BOTH parent and child processes. A subagent's cwd is a worktree
  // of the same repo (shared git remote), so it matches the same registry entry —
  // giving children the same delivery overlay (e.g. local-only push-deny) AND the
  // repo's autonomy. This is what lets unattended repos run headless subagents
  // while attended/unregistered repos correctly fail closed (writer subagents
  // stall with no UI rather than auto-acting). resolveDeliveryState is fail-safe
  // (never throws).
  // CAVEAT: the registry match is by git REMOTE. A registry entry keyed only by
  // `path` (no `match`/remote), or a repo with no `origin`, won't match for a
  // subagent (its cwd is the worktree path), so it falls back to the safe default
  // (local-only/attended) — fail-safe, but path-only entries don't propagate to
  // subagents.
  const deliveryStatePromise = resolveDeliveryState(process.cwd());
  // The overlay is a session constant (mode never changes mid-session), so derive
  // it once here instead of recomputing it on every tool call at the gate.
  const deliveryOverlayPromise = deliveryStatePromise.then((d) => deliveryPolicyOverlay(d.mode));

  async function requirePolicy(ctx: ExtensionContext) {
    const policyState = await policyStatePromise;
    if (policyState.kind === "error") {
      const theme = ctx.ui.theme ?? noopTheme;
      ctx.ui.notify(formatPanel(theme, "Policy Error", policyState.error, "error"), "warning");
      return undefined;
    }
    return policyState.policy;
  }

  // ── MCP server management (main session only) ───────────────────────
  const mcpManager = isSubagent ? null : new MCPManager();

  pi.on("session_start", async (event, ctx) => {
    reviewFindings = [];
    todoState = reconstructTodoState(ctx.sessionManager.getBranch());
    ctx.ui.setStatus("harness-todo", todoStatusSegment(ctx, todoState));
    if (!mcpManager) return;

    const theme = ctx.ui.theme;

    // session_start is parent-only (the `if (!mcpManager) return` guard above).
    // If the registry locks yolo, enforce it here too — idempotent with the
    // env-based lock applied at construction.
    const delivery = await deliveryStatePromise;
    if (delivery?.yoloLocked) permissions.lockYolo();

    // Show yolo/lens status if default-on
    if (permissions.isYolo) {
      ctx.ui.setStatus("harness-yolo", theme.fg("error", "⚡ yolo"));
    }
    lens.setStatus(ctx);

    // Delivery mode status segment (autonomy shown only when unattended).
    if (delivery) {
      const label = `mode:${delivery.mode}${delivery.autonomy === "unattended" ? " ⚙ unattended" : ""}`;
      ctx.ui.setStatus("harness-delivery", theme.fg("accent", label));
    }

    let mcpSummary: WelcomeMcpSummary = { configured: 0, connected: 0, failed: 0, initFailed: false };

    // ── Thanos welcome header — two-column layout, clears on first prompt ─
    if (event.reason === "startup" || event.reason === "new") {
      const model = ctx.model;
      const modelStr = model ? (model.name || model.id) : "—";
      const thinkingStr = (pi.getThinkingLevel() as string) || "off";
      const policyState = await policyStatePromise;
      const policy: WelcomePolicySummary = policyState.kind === "ok"
        ? {
            kind: "loaded",
            preset: policyState.policy.preset,
            rules: policyState.policy.rules.length,
            auditEnabled: policyState.policy.audit.enabled,
          }
        : { kind: "error" };

      type SessionRow = { label: string; age: string };
      let recentRows: SessionRow[] = [];
      try {
        const sessions = await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
        recentRows = sessions
          .sort((a, b) => b.modified.getTime() - a.modified.getTime())
          .slice(0, 5)
          .map((s) => ({
            label: (s.name || s.firstMessage || "Untitled").slice(0, 72),
            age: formatTimeAgo(s.modified),
          }));
      } catch { /* session dir may not exist yet */ }

      ctx.ui.setHeader((_tui, theme) => renderWelcomeHeader(theme, {
        modelStr,
        thinkingStr,
        modeStr: String(defaultTaskType ?? "explore (default)"),
        mcp: mcpSummary,
        policy,
        recentRows,
      }));

      // Non-blocking release check (cached 24h). Failure is silent — an
      // offline session should never see noise from this.
      checkForUpdate().then((update) => {
        if (update?.updateAvailable) {
          ctx.ui.notify(
            `Thanos ${update.latest} is available (you have v${update.current}) — run 'thanos update' to upgrade.`,
            "info",
          );
        }
      }).catch(() => {});
    }

    initializeMcpSession({ manager: mcpManager, pi, cwd: ctx.cwd }).then((init) => {
      mcpSummary = {
        configured: init.statuses.length,
        connected: init.connectedCount,
        failed: init.statuses.filter((s) => s.error).length,
        initFailed: init.kind === "failed",
      };
      if (init.kind === "failed") {
        ctx.ui.notify(`MCP init failed: ${init.error}`, "warning");
        return;
      }
      const connected = init.statuses.filter((s) => !s.error);
      const failed = init.statuses.filter((s) => s.error);
      if (connected.length > 0) {
        ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${connected.length}`));
      }
      if (failed.length > 0) {
        const summary = failed.map((s) => `${theme.fg("error", s.name)}: ${s.error}`).join("\n  ");
        ctx.ui.notify(formatPanel(theme, "MCP Failed", summary, "error"), "warning");
      }
    }).catch((err) => {
      ctx.ui.notify(`MCP init failed: ${err instanceof Error ? err.message : String(err)}`, "warning");
    });
  });

  pi.on("session_tree", async (_event, ctx) => {
    todoState = reconstructTodoState(ctx.sessionManager.getBranch());
    ctx.ui.setStatus("harness-todo", todoStatusSegment(ctx, todoState));
  });

  // ── --spec flag ────────────────────────────────────────────────────
  pi.registerFlag("spec", {
    type: "boolean",
    default: false,
    description: "Require approval before first edit/exec when task is ambient",
  });

  pi.registerCommand("modes", {
    description: "Choose the default specialist subagent for this session",
    getArgumentCompletions: (prefix) => {
      const filtered = (AGENT_TYPES as readonly string[]).filter((mode) => mode.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const explicit = (AGENT_TYPES as readonly string[]).includes(trimmed) ? (trimmed as NonNullable<TaskParams["type"]>) : undefined;
      if (!ctx.hasUI && !explicit) {
        ctx.ui.notify("Modes selector requires an interactive UI", "warning");
        return;
      }

      const selected = explicit ?? (await ctx.ui.select("Choose a default subagent mode", [...AGENT_TYPES]));
      if (!selected) return;
      defaultTaskType = selected as NonNullable<TaskParams["type"]>;
      ctx.ui.setStatus("harness-mode", ctx.ui.theme.fg("accent", `modes:${selected}`));
      ctx.ui.notify(`Default subagent mode: ${selected}`, "info");
    },
  });

  pi.registerCommand("todo", {
    description: "Show the current todo checklist for this branch",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (trimmed === "export" || !ctx.hasUI) {
        ctx.ui.notify(exportTodoMarkdown(todoState), "info");
        return;
      }
      const theme = ctx.ui.theme;
      await ctx.ui.custom<void>((_tui, _theme, _kb, done) => ({
        handleInput(data: string) {
          if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done();
        },
        render(width: number) {
          const lines = ["", ...renderTodoLines(todoState, theme), "", theme.fg("dim", "  Press Escape to close")];
          // fitTerminalText is ANSI-aware; a plain slice would count escape codes
          // against the width and could cut a sequence mid-byte, leaking color.
          return lines.map((l) => fitTerminalText(l, width));
        },
        invalidate() {},
      }));
    },
    getArgumentCompletions: (prefix) =>
      "export".startsWith(prefix) ? [{ value: "export", label: "export markdown" }] : null,
  });

  // ── /remember + /memory — hand-curated project preferences ────────
  // The only write path into .harness/memory.json (auto-capture was removed
  // after it memorized one-off instructions as durable preferences). Parent
  // sessions only, so a subagent can never plant a memory.
  const projectMemory = () => ({
    store: MemoryStore.open(join(process.cwd(), ".harness", "memory.json")),
    project: process.cwd().split("/").pop() ?? "unknown",
  });

  if (!isSubagent) {
    pi.registerCommand("remember", {
      description: "Save a durable project preference, injected into future sessions",
      handler: async (args, ctx) => {
        const { store, project } = projectMemory();
        const result = store.save({ project, text: args });
        if (result.saved) {
          ctx.ui.notify(`Remembered for ${project}: ${result.record.text}`, "info");
        } else if (result.reason === "empty") {
          ctx.ui.notify("Usage: /remember <preference>", "warning");
        } else if (result.reason === "too-long") {
          ctx.ui.notify(`Memory too long (max ${MAX_MEMORY_LENGTH} chars) — distill it first.`, "warning");
        } else {
          ctx.ui.notify("Already remembered — see /memory.", "warning");
        }
      },
    });

    pi.registerCommand("memory", {
      description: "List remembered project preferences; `/memory forget <n>` removes one",
      getArgumentCompletions: (prefix) =>
        "forget".startsWith(prefix) ? [{ value: "forget", label: "forget <n>" }] : null,
      handler: async (args, ctx) => {
        const { store, project } = projectMemory();
        const memories = store.query({ project, limit: 50 });
        const trimmed = args.trim();
        if (trimmed === "") {
          if (memories.length === 0) {
            ctx.ui.notify(`No memories for ${project}. Add one with /remember <preference>.`, "info");
            return;
          }
          const lines = memories.map((m, i) => `${i + 1}. ${m.text}`);
          ctx.ui.notify(`Memories for ${project} (newest first; first 10 are injected):\n${lines.join("\n")}`, "info");
          return;
        }
        const match = /^forget\s+(\d+)$/.exec(trimmed);
        if (!match) {
          ctx.ui.notify("Usage: /memory  or  /memory forget <n>", "warning");
          return;
        }
        const target = memories[Number(match[1]) - 1];
        if (!target) {
          ctx.ui.notify(`No memory #${match[1]} — run /memory to see the list.`, "warning");
          return;
        }
        store.remove(target.id);
        ctx.ui.notify(`Forgot: ${target.text}`, "info");
      },
    });
  }

  // ── /yolo — bypass all permission checks ──────────────────────────
  pi.registerCommand("yolo", {
    description: "Toggle yolo mode — skips all permission prompts and policy checks.",
    handler: async (_args, ctx) => {
      if (permissions.yoloLocked) {
        ctx.ui.notify("Yolo is disabled by configuration.", "warning");
        return;
      }
      const theme = ctx.ui.theme;
      const current = permissions.isYolo;

      if (!current) {
        // Require explicit confirmation before enabling
        if (ctx.hasUI) {
          const ok = await ctx.ui.confirm(
            "Enable Yolo Mode?",
            "All permission checks, policy rules, and confirmation prompts will be bypassed.\n" +
            "The agent will execute any tool without asking. Use in trusted environments only.",
          );
          if (!ok) {
            ctx.ui.notify("Yolo mode not enabled.", "info");
            return;
          }
        }
        permissions.setYolo(true);
        ctx.ui.setStatus("harness-yolo", theme.fg("error", "⚡ yolo"));
        ctx.ui.notify(
          formatPanel(theme, "Yolo Mode ON", [
            theme.fg("warning", "All permission checks are now bypassed."),
            theme.fg("dim", "Run /yolo again to restore normal permission behavior."),
          ], "warning"),
          "warning",
        );
      } else {
        permissions.setYolo(false);
        ctx.ui.setStatus("harness-yolo", undefined);
        ctx.ui.notify(
          formatPanel(theme, "Yolo Mode OFF", "Permission checks restored.", "dim"),
          "info",
        );
      }
    },
  });

  // ── /ship — deliver the current branch per the resolved delivery mode ──

  pi.registerCommand("ship", {
    description: "Ship the current branch per delivery mode (local-only: fast-forward merge into the default branch).",
    handler: async (_args, ctx) => {
      const theme = ctx.ui.theme ?? noopTheme;

      if (isSubagent) {
        ctx.ui.notify("/ship is only available in the main session.", "warning");
        return;
      }

      const delivery = await deliveryStatePromise;

      const currentBranch = await getCurrentBranch(process.cwd());
      if (!currentBranch) {
        ctx.ui.notify(
          formatPanel(theme, "Ship Failed", "Could not determine the current branch (detached HEAD or not a git repo?).", "error"),
          "warning",
        );
        return;
      }

      const target = delivery.defaultBranch;

      // direct-PR / no-mistakes: Thanos does not push in v1. Hand the PR step back.
      if (delivery.mode !== "local-only") {
        ctx.ui.notify(
          formatPanel(theme, `Ship — ${delivery.mode}`, [
            theme.fg("dim", `Thanos does not push or open PRs in v1 (mode: ${delivery.mode}).`),
            `Confirm gates are green on ${theme.fg("accent", currentBranch)}, then push / open the PR yourself.`,
            theme.fg("dim", `Gates: ${formatGateNames(delivery.gates)}`),
          ], "accent"),
          "info",
        );
        return;
      }

      // Defensive: the ship file may request a non-fast-forward merge. Thanos
      // only ever fast-forwards in v1, so make that explicit instead of silently
      // fast-forwarding against the file's intent.
      if (delivery.merge !== "fast-forward") {
        ctx.ui.notify(
          formatPanel(theme, "Ship Not Performed", [
            theme.fg("dim", `The ship file requests a "${delivery.merge}" merge, which Thanos does not perform in v1.`),
            `Merge ${theme.fg("accent", currentBranch)} into ${theme.fg("accent", target)} yourself.`,
          ], "warning"),
          "warning",
        );
        return;
      }

      // local-only: fast-forward merge of the current branch into the default branch.
      if (currentBranch === target) {
        ctx.ui.notify(
          formatPanel(theme, "Nothing to Ship", `You are already on ${theme.fg("accent", target)}; switch to a feature branch first.`, "warning"),
          "warning",
        );
        return;
      }

      // Gate verification: require an explicit human confirmation that gates are
      // green before mutating the local default branch. This is the simpler,
      // robust option vs. re-running arbitrary repo-defined gate commands here.
      if (!ctx.hasUI) {
        ctx.ui.notify(
          formatPanel(theme, "Ship Needs Confirmation", "/ship requires an interactive UI to confirm gates before merging.", "warning"),
          "warning",
        );
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Gates green?",
        `Confirm all required gates passed, then fast-forward merge ${currentBranch} into ${target}.\n` +
        `Gates: ${formatGateNames(delivery.gates)}\n` +
        "Thanos will NOT push — this only advances your local default branch.",
      );
      if (!confirmed) {
        ctx.ui.notify("Ship cancelled.", "info");
        return;
      }

      const result = await fastForwardMerge(process.cwd(), currentBranch, target);
      if (result.ok) {
        ctx.ui.notify(
          formatPanel(theme, "Shipped", [
            `${theme.fg("success", currentBranch)} fast-forwarded into ${theme.fg("accent", target)} (local only).`,
            theme.fg("dim", "No push was performed — push when you are ready."),
          ], "dim"),
          "info",
        );
      } else {
        ctx.ui.notify(
          formatPanel(theme, "Ship Failed", [
            `Could not fast-forward ${theme.fg("accent", target)} to ${currentBranch}.`,
            theme.fg("error", result.reason ?? "unknown error"),
          ], "error"),
          "warning",
        );
      }
    },
  });

  // ── /mcp — MCP server lifecycle management ───────────────────────

  pi.registerCommand("mcp", {
    description: "Manage MCP servers: list, enable, disable, auth, connect, reload…",
    getArgumentCompletions: async (prefix) => {
      const SUBS = ["list", "reload", "paths", "enable", "disable", "auth", "reauth", "connect", "disconnect"];
      // If nothing typed yet or still on the subcommand, complete subcommands
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length <= 1) {
        const filtered = SUBS.filter((s) => s.startsWith(parts[0] ?? ""));
        return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
      }
      // Second token: complete server names for subcommands that take one
      const sub = parts[0]!;
      const nameSubs = ["enable", "disable", "auth", "reauth", "connect", "disconnect"];
      if (nameSubs.includes(sub)) {
        const names = mcpManager ? mcpManager.getKnownNames() : Object.keys((await loadMcpConfigs(process.cwd())).merged);
        const namePrefix = parts[1] ?? "";
        const filtered = names.filter((n) => n.startsWith(namePrefix));
        return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
      }
      return null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub   = parts[0] ?? "";
      const name  = parts[1] ?? "";
      const theme = ctx.ui.theme;

      // ── paths ────────────────────────────────────────────────────────────
      if (sub === "paths") {
        const paths = mcpConfigPaths(ctx.cwd);
        const content = [
          theme.bold("MCP config file locations:"),
          `  ${formatLabel(theme, "global", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.global)}`,
          `  ${formatLabel(theme, "user", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.user)}`,
          `  ${formatLabel(theme, "project", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.project)}`,
        ].join("\n");
        ctx.ui.notify(formatPanel(theme, "MCP Configs", content, "dim"), "info");
        return;
      }

      // ── reload ───────────────────────────────────────────────────────────
      if (sub === "reload") {
        if (isSubagent) { ctx.ui.notify("/mcp reload is only available in the main session.", "warning"); return; }
        if (!mcpManager) return;
        const result = await reloadMcpSession({ manager: mcpManager, pi, cwd: ctx.cwd });
        if (result.kind === "failed") {
          ctx.ui.notify(`MCP reload failed: ${result.error}`, "warning");
        } else {
          ctx.ui.notify(`${theme.bold("MCP reloaded")} ${theme.fg("dim", "—")} ${theme.fg("success", String(result.connectedCount))} server(s) connected.`, "info");
        }
        return;
      }

      // ── disable <name> ───────────────────────────────────────────────────
      if (sub === "disable") {
        if (isSubagent) { ctx.ui.notify("/mcp disable is only available in the main session.", "warning"); return; }
        if (!mcpManager) return;
        if (!name) { ctx.ui.notify("Usage: /mcp disable <server-name>", "warning"); return; }
        const result = await disableMcpServer({ manager: mcpManager, name });
        if (result.kind === "unknown-server") { ctx.ui.notify(`Unknown server: ${theme.fg("error", name)}`, "warning"); return; }
        if (result.kind === "failed") { ctx.ui.notify(`MCP disable failed: ${result.error}`, "warning"); return; }
        ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
        ctx.ui.notify(formatPanel(theme, "MCP Disabled", `${theme.fg("error", name)} disconnected and marked disabled.`, "warning"), "info");
        return;
      }

      // ── enable <name> ────────────────────────────────────────────────────
      if (sub === "enable") {
        if (isSubagent) { ctx.ui.notify("/mcp enable is only available in the main session.", "warning"); return; }
        if (!mcpManager) return;
        if (!name) { ctx.ui.notify("Usage: /mcp enable <server-name>", "warning"); return; }
        ctx.ui.notify(`Connecting ${theme.fg("accent", name)}…`, "info");
        const result = await enableMcpServer({ manager: mcpManager, pi, name });
        if (result.kind === "unknown-server") { ctx.ui.notify(`Unknown server: ${theme.fg("error", name)}`, "warning"); return; }
        if (result.kind === "failed") {
          ctx.ui.notify(formatPanel(theme, "MCP Enable Failed", `${theme.fg("error", name)}: ${result.status?.error ?? result.error}`, "error"), "warning");
        } else {
          ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
          ctx.ui.notify(formatPanel(theme, "MCP Enabled", `${theme.fg("success", name)} connected — ${result.status?.toolCount ?? 0} tool(s).`, "dim"), "info");
        }
        return;
      }

      // ── connect <name> ───────────────────────────────────────────────────
      if (sub === "connect") {
        if (isSubagent) { ctx.ui.notify("/mcp connect is only available in the main session.", "warning"); return; }
        if (!mcpManager) return;
        if (!name) { ctx.ui.notify("Usage: /mcp connect <server-name>", "warning"); return; }
        ctx.ui.notify(`Connecting ${theme.fg("accent", name)}…`, "info");
        const result = await connectMcpServer({ manager: mcpManager, pi, name });
        if (result.kind === "unknown-server") { ctx.ui.notify(`Unknown server: ${theme.fg("error", name)}`, "warning"); return; }
        if (result.kind === "failed") {
          ctx.ui.notify(formatPanel(theme, "MCP Connect Failed", `${theme.fg("error", name)}: ${result.status?.error ?? result.error}`, "error"), "warning");
        } else {
          ctx.ui.notify(formatPanel(theme, "MCP Connected", `${theme.fg("success", name)} — ${result.status?.toolCount ?? 0} tool(s).`, "dim"), "info");
        }
        return;
      }

      // ── disconnect <name> ────────────────────────────────────────────────
      if (sub === "disconnect") {
        if (isSubagent) { ctx.ui.notify("/mcp disconnect is only available in the main session.", "warning"); return; }
        if (!mcpManager) return;
        if (!name) { ctx.ui.notify("Usage: /mcp disconnect <server-name>", "warning"); return; }
        const result = disconnectMcpServer({ manager: mcpManager, name });
        if (result.kind === "unknown-server" || result.kind === "not-connected") {
          ctx.ui.notify(`${theme.fg("error", name)} is not connected.`, "warning");
          return;
        }
        if (result.kind === "failed") { ctx.ui.notify(`MCP disconnect failed: ${result.error}`, "warning"); return; }
        ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
        ctx.ui.notify(formatPanel(theme, "MCP Disconnected", `${theme.fg("accent", name)} disconnected (not disabled — run /mcp connect ${name} to reconnect).`, "dim"), "info");
        return;
      }

      // ── auth <name> / reauth <name> ──────────────────────────────────────
      if (sub === "auth" || sub === "reauth") {
        if (isSubagent) { ctx.ui.notify(`/mcp ${sub} is only available in the main session.`, "warning"); return; }
        if (!mcpManager) return;
        if (!name) { ctx.ui.notify(`Usage: /mcp ${sub} <server-name>`, "warning"); return; }
        if (!ctx.hasUI) { ctx.ui.notify(`/mcp ${sub} requires an interactive UI.`, "warning"); return; }

        const config = mcpManager.getConfig(name);
        if (!config) { ctx.ui.notify(`Unknown server: ${theme.fg("error", name)}`, "warning"); return; }

        // Load existing secrets to show in reauth
        const existing = sub === "reauth" ? await readServerSecrets(name) : {};

        if (config.type === "stdio") {
          // Collect env vars one at a time: KEY then VALUE
          const existingKeys = sub === "reauth" && existing.env ? Object.keys(existing.env) : [];
          const hintStr = existingKeys.length > 0 ? existingKeys.map((k) => `${k}=***`).join(", ") : "";
          const key = await ctx.ui.input(
            fitTerminalText(`Set env var for ${name} — KEY`, DEFAULT_PICKER_LABEL_WIDTH),
            hintStr ? `Existing: ${hintStr}` : "e.g. OPENAI_API_KEY",
          );
          if (!key?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
          const val = await ctx.ui.input(
            fitTerminalText(`Set env var for ${name} — VALUE for ${key.trim()}`, DEFAULT_PICKER_LABEL_WIDTH),
            "(hidden after saving)",
          );
          if (val === undefined) { ctx.ui.notify("Auth cancelled.", "info"); return; }
          await writeServerSecrets(name, { env: { [key.trim()]: val } });
        } else {
          // HTTP server: check for OAuth first
          if (!config.url) { ctx.ui.notify(`${theme.fg("error", name)} is missing a URL.`, "warning"); return; }
          const needsOAuth = await probeOAuth(config.url);
          if (needsOAuth) {
            ctx.ui.notify(
              formatPanel(theme, "OAuth Authorization",
                `Opening browser for ${theme.fg("accent", name)}…\n${theme.fg("dim", "Complete the flow in your browser, then return here.")}`,
                "dim"),
              "info",
            );
            try {
              const { accessToken, refreshToken } = await runOAuthFlow(config.url);
              const oauthMeta = await fetchOAuthMeta(config.url);
              await writeServerSecrets(name, {
                headers: { Authorization: `Bearer ${accessToken}` },
                oauth: {
                  refreshToken,
                  tokenEndpoint: oauthMeta?.token_endpoint,
                  clientId: "pi-harness",
                },
              });
            } catch (err) {
              ctx.ui.notify(
                formatPanel(theme, "OAuth Failed", String(err), "error"),
                "warning",
              );
              return;
            }
          } else {
            const existingHdrs = sub === "reauth" && existing.headers ? Object.keys(existing.headers) : [];
            const hintStr = existingHdrs.length > 0 ? existingHdrs.map((k) => `${k}: ***`).join(", ") : "";
            const header = await ctx.ui.input(fitTerminalText(`Set header for ${name} — Header name`, DEFAULT_PICKER_LABEL_WIDTH), hintStr ? `Existing: ${hintStr}` : "e.g. Authorization");
            if (!header?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
            const val = await ctx.ui.input(fitTerminalText(`Set header for ${name} — Value for ${header.trim()}`, DEFAULT_PICKER_LABEL_WIDTH), "e.g. Bearer sk-…");
            if (val === undefined) { ctx.ui.notify("Auth cancelled.", "info"); return; }
            await writeServerSecrets(name, { headers: { [header.trim()]: val.trim() } });
          }
        }

        // Reconnect to pick up new credentials
        ctx.ui.notify(`Credentials saved. Reconnecting ${theme.fg("accent", name)}…`, "info");
        const reconnect = await connectMcpServer({ manager: mcpManager, pi, name });
        if (reconnect.kind === "unknown-server") {
          ctx.ui.notify(`Unknown server: ${theme.fg("error", name)}`, "warning");
        } else if (reconnect.kind === "failed") {
          ctx.ui.notify(formatPanel(theme, "Reconnect Failed", `${theme.fg("error", name)}: ${reconnect.status?.error ?? reconnect.error}`, "error"), "warning");
        } else {
          ctx.ui.notify(formatPanel(theme, "Auth Complete", `${theme.fg("success", name)} — ${reconnect.status?.toolCount ?? 0} tool(s) ready.`, "dim"), "info");
        }
        return;
      }

      // ── list (default) ───────────────────────────────────────────────────
      if (isSubagent) {
        const { merged, sources } = await loadMcpConfigs(ctx.cwd);
        const names = Object.keys(merged);
        if (names.length === 0) {
          ctx.ui.notify("No MCP servers configured.\nRun /mcp paths to see where to add them.", "info");
          return;
        }
        const lines = names.map((n) => `  ${theme.fg("accent", n)}  ${theme.fg("dim", `[${sources[n]}]`)}`);
        ctx.ui.notify(formatPanel(theme, "MCP Configured", lines, "dim"), "info");
        return;
      }

      if (!mcpManager) return;
      const statuses = mcpManager.getStatuses();
      if (statuses.length === 0) {
        const paths = mcpConfigPaths(ctx.cwd);
        const content = [
          "No MCP servers configured.",
          "",
          "Add servers to any of:",
          `  ${formatLabel(theme, "global", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.global)}`,
          `  ${formatLabel(theme, "user", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.user)}`,
          `  ${formatLabel(theme, "project", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.project)}`,
        ].join("\n");
        ctx.ui.notify(formatPanel(theme, "MCP Setup", content, "warning"), "info");
        return;
      }

      // ── Interactive mode: pick a server, then pick an action ─────────
      if (ctx.hasUI) {
        // Build labelled options showing server state inline
        const optionDetails = statuses.map((s) => {
          if (s.disabled) return `○  ${s.name}  [${s.source}]  disabled`;
          const icon   = s.error ? "✗" : "✓";
          const detail = s.error ? `error` : `${s.toolCount} tools`;
          return `${icon}  ${s.name}  [${s.source}]  ${detail}`;
        });
        const options = makeTerminalSafeOptions(optionDetails);

        const picked = await ctx.ui.select("Select an MCP server", options);
        if (!picked) return;

        // Resolve which status entry was chosen
        const idx    = options.indexOf(picked);
        const status = statuses[idx];
        if (!status) return;
        const sName = status.name;

        // Build contextual action list based on current state
        const actions: string[] = [];
        if (status.disabled) {
          actions.push("enable — reconnect this server");
        } else {
          if (status.connected) {
            actions.push("disconnect — drop connection (keeps enabled)");
            actions.push("disable — disconnect and mark disabled");
          } else {
            actions.push("connect — (re)connect this server");
            actions.push("disable — mark disabled");
          }
          actions.push("auth — set / update credentials, then reconnect");
          actions.push("reauth — edit existing credentials, then reconnect");
        }

        const action = await ctx.ui.select(fitTerminalText(`Action for: ${sName}`, DEFAULT_PICKER_LABEL_WIDTH), actions);
        if (!action) return;
        const verb = action.split(" ")[0]!;

        // Dispatch via the same lifecycle helpers used by explicit subcommands
        if (verb === "enable") {
          ctx.ui.notify(`Connecting ${theme.fg("accent", sName)}…`, "info");
          const result = await enableMcpServer({ manager: mcpManager, pi, name: sName });
          if (result.kind === "unknown-server") {
            ctx.ui.notify(`Unknown server: ${theme.fg("error", sName)}`, "warning");
          } else if (result.kind === "failed") {
            ctx.ui.notify(
              formatPanel(theme, "Enable Failed", `${theme.fg("error", sName)}: ${result.status?.error ?? result.error}`, "error"),
              "warning",
            );
          } else {
            ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
            ctx.ui.notify(
              result.status?.error
                ? formatPanel(theme, "Enable Failed", `${theme.fg("error", sName)}: ${result.status.error}`, "error")
                : formatPanel(theme, "MCP Enabled", `${theme.fg("success", sName)} — ${result.status?.toolCount ?? 0} tool(s).`, "dim"),
              result.status?.error ? "warning" : "info",
            );
          }

        } else if (verb === "disable") {
          const result = await disableMcpServer({ manager: mcpManager, name: sName });
          if (result.kind === "unknown-server") {
            ctx.ui.notify(`Unknown server: ${theme.fg("error", sName)}`, "warning");
          } else if (result.kind === "failed") {
            ctx.ui.notify(`MCP disable failed: ${result.error}`, "warning");
          } else {
            ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
            ctx.ui.notify(formatPanel(theme, "MCP Disabled", `${theme.fg("error", sName)} disconnected and marked disabled.`, "warning"), "info");
          }

        } else if (verb === "connect") {
          ctx.ui.notify(`Connecting ${theme.fg("accent", sName)}…`, "info");
          const result = await connectMcpServer({ manager: mcpManager, pi, name: sName });
          if (result.kind === "unknown-server") {
            ctx.ui.notify(`Unknown server: ${theme.fg("error", sName)}`, "warning");
          } else if (result.kind === "failed") {
            ctx.ui.notify(
              formatPanel(theme, "Connect Failed", `${theme.fg("error", sName)}: ${result.status?.error ?? result.error}`, "error"),
              "warning",
            );
          } else {
            ctx.ui.notify(formatPanel(theme, "MCP Connected", `${theme.fg("success", sName)} — ${result.status?.toolCount ?? 0} tool(s).`, "dim"), "info");
          }

        } else if (verb === "disconnect") {
          const result = disconnectMcpServer({ manager: mcpManager, name: sName });
          if (result.kind === "unknown-server" || result.kind === "not-connected") {
            ctx.ui.notify(`${theme.fg("error", sName)} is not connected.`, "warning");
          } else if (result.kind === "failed") {
            ctx.ui.notify(`MCP disconnect failed: ${result.error}`, "warning");
          } else {
            ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
            ctx.ui.notify(formatPanel(theme, "MCP Disconnected", `${theme.fg("accent", sName)} disconnected (run /mcp connect ${sName} to reconnect).`, "dim"), "info");
          }

        } else if (verb === "auth" || verb === "reauth") {
          const config = mcpManager.getConfig(sName);
          if (!config) return;
          const existing = verb === "reauth" ? await readServerSecrets(sName) : {};
          if (config.type === "stdio") {
            const existingKeys = verb === "reauth" && existing.env ? Object.keys(existing.env) : [];
            const hintStr = existingKeys.length > 0 ? existingKeys.map((k) => `${k}=***`).join(", ") : "";
            const key = await ctx.ui.input(fitTerminalText(`Env var KEY for ${sName}`, DEFAULT_PICKER_LABEL_WIDTH), hintStr ? `Existing: ${hintStr}` : "e.g. OPENAI_API_KEY");
            if (!key?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
            const val = await ctx.ui.input(fitTerminalText(`Value for ${key.trim()}`, DEFAULT_PICKER_LABEL_WIDTH), "(hidden after saving)");
            if (val === undefined) { ctx.ui.notify("Auth cancelled.", "info"); return; }
            await writeServerSecrets(sName, { env: { [key.trim()]: val } });
          } else {
            // HTTP server: probe for OAuth, run browser flow if detected
            if (!config.url) { ctx.ui.notify(`${theme.fg("error", sName)} is missing a URL.`, "warning"); return; }
            const needsOAuth = await probeOAuth(config.url);
            if (needsOAuth) {
              ctx.ui.notify(
                formatPanel(theme, "OAuth Authorization",
                  `Opening browser for ${theme.fg("accent", sName)}…\n${theme.fg("dim", "Complete the flow in your browser, then return here.")}`,
                  "dim"),
                "info",
              );
              try {
                const { accessToken, refreshToken } = await runOAuthFlow(config.url);
                const oauthMeta = await fetchOAuthMeta(config.url);
                await writeServerSecrets(sName, {
                  headers: { Authorization: `Bearer ${accessToken}` },
                  oauth: {
                    refreshToken,
                    tokenEndpoint: oauthMeta?.token_endpoint,
                    clientId: "pi-harness",
                  },
                });
              } catch (err) {
                ctx.ui.notify(
                  formatPanel(theme, "OAuth Failed", String(err), "error"),
                  "warning",
                );
                return;
              }
            } else {
              const existingHdrs = verb === "reauth" && existing.headers ? Object.keys(existing.headers) : [];
              const hintStr = existingHdrs.length > 0 ? existingHdrs.map((k) => `${k}: ***`).join(", ") : "";
              const header = await ctx.ui.input(fitTerminalText(`Header name for ${sName}`, DEFAULT_PICKER_LABEL_WIDTH), hintStr ? `Existing: ${hintStr}` : "e.g. Authorization");
              if (!header?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
              const val = await ctx.ui.input(fitTerminalText(`Value for ${header.trim()}`, DEFAULT_PICKER_LABEL_WIDTH), "e.g. Bearer sk-…");
              if (val === undefined) { ctx.ui.notify("Auth cancelled.", "info"); return; }
              await writeServerSecrets(sName, { headers: { [header.trim()]: val.trim() } });
            }
          }
          ctx.ui.notify(`Credentials saved. Reconnecting ${theme.fg("accent", sName)}…`, "info");
          const reconnect = await connectMcpServer({ manager: mcpManager, pi, name: sName });
          if (reconnect.kind === "unknown-server") {
            ctx.ui.notify(`Unknown server: ${theme.fg("error", sName)}`, "warning");
          } else if (reconnect.kind === "failed") {
            ctx.ui.notify(formatPanel(theme, "Reconnect Failed", `${theme.fg("error", sName)}: ${reconnect.status?.error ?? reconnect.error}`, "error"), "warning");
          } else {
            ctx.ui.notify(formatPanel(theme, "Auth Complete", `${theme.fg("success", sName)} — ${reconnect.status?.toolCount ?? 0} tool(s) ready.`, "dim"), "info");
          }
        }
        return;
      }

      // ── Headless fallback: print static panel ─────────────────────────
      const lines = statuses.map((s) => {
        if (s.disabled) {
          return `  ${theme.fg("dim", "○")} ${theme.fg("dim", s.name.padEnd(20, " "))} ${theme.fg("dim", `[${s.source}]`)}  ${theme.fg("dim", "disabled")}`;
        }
        const tag    = s.error ? theme.fg("error", "✗") : theme.fg("success", "✓");
        const detail = s.error ? theme.fg("error", s.error) : `${s.toolCount} tool(s)`;
        return `  ${tag} ${theme.fg("accent", s.name.padEnd(20, " "))} ${theme.fg("dim", `[${s.source}]`)}  ${theme.fg("dim", "—")} ${detail}`;
      });
      const ok = statuses.filter((s) => s.connected).length;
      const dis = statuses.filter((s) => s.disabled).length;
      const title = dis > 0
        ? `MCP Status (${ok}/${statuses.length} connected, ${dis} disabled)`
        : `MCP Status (${ok}/${statuses.length} connected)`;
      ctx.ui.notify(formatPanel(theme, title, lines, "dim"), "info");
    },
  });

  // ── Thinking level selector ────────────────────────────────────────
  pi.registerCommand("thinking", {
    description: "Select reasoning effort level for the current model",
    getArgumentCompletions: (prefix) => {
      const filtered = ALL_THINKING_LEVELS.filter((l) => l.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim() as ThinkingLevel;
      if (ALL_THINKING_LEVELS.includes(trimmed)) {
        pi.setThinkingLevel(trimmed);
        setThinkingStatus(pi, ctx);
        ctx.ui.notify(`Thinking: ${trimmed}`, "info");
        return;
      }
      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("No model active", "warning");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("Thinking selector requires an interactive UI", "warning");
        return;
      }
      const levels = getSupportedLevels(model);
      const options = levels.map((l) => THINKING_LABELS[l]);
      const selected = await ctx.ui.select("Select thinking level", options);
      if (!selected) return;
      const level = levels[options.indexOf(selected)];
      if (!level) return;
      pi.setThinkingLevel(level);
      setThinkingStatus(pi, ctx);
    },
  });

  // ── Auto-prompt thinking level when switching to a reasoning model ──
  pi.on("model_select", async (event, ctx) => {
    if (!event.model.reasoning) {
      ctx.ui.setStatus("harness-thinking", undefined);
      return;
    }
    if (!ctx.hasUI) return;
    const levels = getSupportedLevels(event.model);
    const options = levels.map((l) => THINKING_LABELS[l]);
    const selected = await ctx.ui.select("Select thinking level", options);
    if (!selected) return;
    const level = levels[options.indexOf(selected)];
    if (!level) return;
    pi.setThinkingLevel(level);
    setThinkingStatus(pi, ctx);
  });

  // ── Keep status bar in sync with Shift+Tab cycles ──────────────────
  pi.on("thinking_level_select", (_event, ctx) => {
    setThinkingStatus(pi, ctx);
  });

  // ── /models — two-step provider→model selector ───────────────────
  pi.registerCommand("models", {
    description: "Select model by provider (two-step picker)",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Model selector requires an interactive UI", "warning");
        return;
      }

      const theme = ctx.ui.theme;
      const models = ctx.modelRegistry.getAll();

      if (models.length === 0) {
        ctx.ui.notify("No models are registered. Add a provider catalog or update Pi.", "warning");
        return;
      }
      const configuredModels = models.filter((m) => ctx.modelRegistry.hasConfiguredAuth(m));
      if (configuredModels.length === 0) {
        ctx.ui.notify("No configured model providers found. Add an API key or OAuth credentials, then reopen /models.", "warning");
        return;
      }

      // Step 1: Group models by authenticated provider so /models only offers
      // providers that can actually switch successfully.
      const providerMap = new Map<string, typeof configuredModels>();
      for (const m of configuredModels) {
        const list = providerMap.get(m.provider) ?? [];
        list.push(m);
        providerMap.set(m.provider, list);
      }

      // Sort providers alphabetically, with current provider first
      const currentProvider = ctx.model?.provider;
      const providers = [...providerMap.entries()].sort(([a], [b]) => {
        if (a === currentProvider) return -1;
        if (b === currentProvider) return 1;
        return a.localeCompare(b);
      });

      // Format provider labels with model count
      const providerLabels = providers.map(([name, models]) => {
        const tag = name === currentProvider ? theme.fg("accent", "●") : theme.fg("dim", "○");
        const authed = models.some((m) => ctx.modelRegistry.hasConfiguredAuth(m));
        const authLabel = authed ? "configured" : "needs key";
        return fitTerminalText(`${tag} ${theme.bold(fixedWidthTerminalText(name, 24))} ${theme.fg("dim", `${models.length} model${models.length !== 1 ? "s" : ""} · ${authLabel}`)}`, DEFAULT_PICKER_LABEL_WIDTH);
      });

      const selectedProvider = await ctx.ui.select("Select provider", providerLabels);
      if (!selectedProvider) return; // cancelled

      const providerIndex = providerLabels.indexOf(selectedProvider);
      if (providerIndex < 0) return;
      const [providerName, providerModels] = providers[providerIndex]!;

      // Sort models: current model first, then by name/id
      const currentModelId = ctx.model?.id;
      const sortedModels = [...providerModels].sort((a, b) => {
        const aCurrent = a.provider === ctx.model?.provider && a.id === currentModelId;
        const bCurrent = b.provider === ctx.model?.provider && b.id === currentModelId;
        if (aCurrent && !bCurrent) return -1;
        if (!aCurrent && bCurrent) return 1;
        return (a.name || a.id).localeCompare(b.name || b.id);
      });

      // Step 2: Pick model within provider
      const modelLabels = sortedModels.map((m) => {
        const isCurrent = m.provider === ctx.model?.provider && m.id === currentModelId;
        const brain = m.reasoning ? "\u{1F9E0}" : "";
        const img = m.input?.includes("image") ? " \u{1F4F7}" : "";
        const tag = isCurrent ? theme.fg("success", " ✓") : "";
        const ctxK = m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : "?";
        const outK = m.maxTokens ? `${Math.round(m.maxTokens / 1000)}k` : "?";
        const auth = ctx.modelRegistry.hasConfiguredAuth(m) ? "" : theme.fg("warning", " · needs key");
        const dims = theme.fg("dim", `${ctxK} ctx · ${outK} out`);
        const suffix = ` ${dims}${brain}${img}${auth}${tag}`;
        const nameWidth = Math.max(16, DEFAULT_PICKER_LABEL_WIDTH - stripAnsi(suffix).length);
        const id = theme.fg("accent", fixedWidthTerminalText(m.name || m.id, nameWidth));
        return fitTerminalText(`${id}${suffix}`, DEFAULT_PICKER_LABEL_WIDTH);
      });

      const selectedModel = await ctx.ui.select(
        `Models for ${providerName}`,
        modelLabels,
      );
      if (!selectedModel) return; // cancelled

      const modelIndex = modelLabels.indexOf(selectedModel);
      if (modelIndex < 0) return;
      const model = sortedModels[modelIndex]!;

      // Step 3: Switch model (triggers model_select → thinking level prompt)
      try {
        const switched = await pi.setModel(model);
        if (switched) {
          ctx.ui.notify(`Switched to ${model.provider}/${model.id}`, "info");
        } else {
          ctx.ui.notify(`No API key for ${model.provider}/${model.id}`, "warning");
        }
      } catch (err) {
        ctx.ui.notify(`Failed to switch: ${err instanceof Error ? err.message : String(err)}`, "warning");
      }
    },
  });

  // ── /goal command (self-checking autonomous loop) ──────────────────
  const recordGoalEvent = (event: { type: "goal_set" | "goal_achieved" | "goal_paused"; summary: string; outcome: string }) =>
    appendHarnessEvent({ ...event, taskId: sessionId, createdAt: new Date().toISOString() }).catch((err) => {
      console.error("[harness][goal]", err instanceof Error ? err.message : String(err));
    });
  registerGoalCommand(pi, {
    controller: goalController,
    isSubagent,
    sendFollowUp: async (text) => { pi.sendUserMessage(text, { deliverAs: "followUp" }); },
    recordEvent: recordGoalEvent,
  });

  // ── goal_complete tool: agent-signaled completion, evaluator-confirmed ──
  // The agent calls this when it believes the active /goal is done. A fresh,
  // tool-less checker (the same evaluator, routed via the subagents toggle,
  // else the session model) confirms against the last turn's evidence before
  // the goal closes. On MET the loop terminates; on NOT_MET the agent keeps
  // working. Crucially, a checker ERROR never pauses the goal — it fails safe
  // to NOT_MET — so the per-turn "eval-error pause" class is gone entirely.
  if (!isSubagent) {
    pi.registerTool({
      name: "goal_complete",
      label: "Goal Complete",
      description:
        "Mark the active /goal complete — only after every requirement is implemented AND verified. A fresh checker confirms before it closes; not for partial progress, a plan, or unverified work.",
      promptSnippet: "Mark the active /goal complete once it is fully finished and verified",
      parameters: Type.Object({
        summary: Type.String({
          description:
            "What you finished and the concrete evidence that verifies it (test output, exit codes, counts, git status).",
        }),
      }),
      async execute(_toolCallId, params: { summary: string }, _signal, _onUpdate, toolCtx: ExtensionContext) {
        const snap = goalController.snapshot();
        if (!snap || snap.status !== "active") {
          return { content: [{ type: "text" as const, text: "goal_complete: no active /goal to complete." }], isError: true, details: undefined };
        }

        // Judge real output, not just the claim: pull the last work turn from
        // the session branch. When that read comes back empty (private branch
        // API drift, or goal_complete called before any proof turn),
        // confirmGoalCompletion fails CLOSED — it never judges the bare summary
        // claim, so self-grading cannot silently sneak back in.
        const sm = toolCtx.sessionManager as { getBranch?: () => Array<{ type?: string; message?: unknown }> } | undefined;
        const evidence = extractLastTurnFromBranch(sm?.getBranch?.());

        // Resolve the evaluator model exactly as the per-turn loop used to:
        // routed override when routing is on, else the session model.
        const override = loadEvaluatorOverride(goalSettings.evaluatorRole);
        const routed = override
          ? pickEvaluatorModel(override, toolCtx.modelRegistry.getAll(), (m) => toolCtx.modelRegistry.hasConfiguredAuth(m))
          : undefined;
        const primary = routed?.model ?? toolCtx.model;
        if (!primary) {
          return { content: [{ type: "text" as const, text: "goal_complete: no model available to verify completion — keep working and try again." }], details: undefined };
        }

        // Retry once on the session model (routing may point at a flaky
        // provider); confirmGoalCompletion owns the fail-closed + fail-safe policy.
        const verdict = await confirmGoalCompletion(
          { condition: snap.condition, previousReason: snap.lastReason, summary: params.summary, evidence },
          (input) => runEvaluatorWith((context) => completeSimple(primary, context, { reasoning: routed?.thinking ?? "low" }), input),
          (input) => runEvaluatorWith((context) => completeSimple(toolCtx.model ?? primary, context, { reasoning: "low" }), input),
        );

        const action = goalController.confirmComplete(verdict);
        toolCtx.ui.setStatus("harness-goal", renderGoalStatusSegment(goalController.snapshot()));

        if (action.kind === "achieved") {
          await recordGoalEvent({ type: "goal_achieved", summary: action.reason, outcome: `turns=${action.turns}` });
          toolCtx.ui.notify(`◎ /goal achieved in ${action.turns} turns — ${action.reason}`, "info");
          return { content: [{ type: "text" as const, text: `Goal confirmed complete: ${action.reason}` }], terminate: true, details: undefined };
        }

        const reason = action.kind === "rejected" ? action.reason : "the goal is no longer active";
        return { content: [{ type: "text" as const, text: `goal_complete rejected — not yet met: ${reason}. Keep working toward the goal, then call goal_complete again once you can show the proof.` }], details: undefined };
      },
    });
  }

  // ── Slash commands ─────────────────────────────────────────────────
  registerSlashCommands(pi, {
    permissions,
    spec,
    policyPromise: policyStatePromise,
    getDefaultTaskType: () => defaultTaskType,
  });
  registerLensLiteCommand(pi, lens);

  // ── Keyboard shortcuts (appear in /hotkeys → Extensions) ───────────
  pi.registerShortcut("ctrl+shift+k", {
    description: "Select thinking level",
    handler: async (ctx) => {
      const model = ctx.model;
      if (!model) { ctx.ui.notify("No model active", "warning"); return; }
      if (!ctx.hasUI) { ctx.ui.notify("Thinking selector requires an interactive UI", "warning"); return; }
      const levels = getSupportedLevels(model);
      const options = levels.map((l) => THINKING_LABELS[l]);
      const selected = await ctx.ui.select("Select thinking level", options);
      if (!selected) return;
      const level = levels[options.indexOf(selected)];
      if (!level) return;
      pi.setThinkingLevel(level);
      setThinkingStatus(pi, ctx);
    },
  });

  // Moved from ctrl+shift+s to avoid conflict with pi-web-access curator
  pi.registerShortcut("ctrl+shift+f", {
    description: "Show session snapshot: model, thinking, mode, spec, context, policy",
    handler: async (ctx) => {
      const policy = await requirePolicy(ctx);
      if (!policy) return;
      const theme = ctx.ui.theme;
      const model = ctx.model;
      const thinking = pi.getThinkingLevel() as ThinkingLevel | undefined;
      const usage = ctx.getContextUsage();
      const active = spec.activeSpec;

      const modelStr = model ? (model.name || model.id) : "none";
      const thinkingStr = thinking && thinking !== "off" ? thinking : "off";
      const modeStr = String(defaultTaskType ?? "explore (default)");

      let contextStr = theme.fg("dim", "unknown");
      if (usage) {
        const pct = usage.percent !== null ? `${Math.round(usage.percent * 100)}%` : "?%";
        const tok = usage.tokens !== null ? usage.tokens.toLocaleString() : "?";
        const wk = Math.round(usage.contextWindow / 1000);
        contextStr = `${formatValue(theme, tok, "accent")} tokens  ${theme.fg("dim", "(")}${usage.percent && usage.percent > 0.8 ? theme.fg("warning", pct) : theme.fg("success", pct)} of ${wk}k${theme.fg("dim", ")")}`;
      }

      const panel = renderSessionSnapshotPanel(theme, {
        modelStr,
        thinkingStr,
        modeStr,
        spec: active,
        contextStr,
        policy,
        yolo: permissions.isYolo,
      });
      ctx.ui.notify(panel, "info");
    },
  });

  pi.registerShortcut("ctrl+shift+e", {
    description: "Show current spec: goal, tier, criteria, verification state",
    handler: async (ctx) => {
      const active = spec.activeSpec;
      const theme = ctx.ui.theme;
      if (!active) {
        ctx.ui.notify(
          "No active spec.\nSpecs generate on ambient and explicit tasks — not instant reads.",
          "info",
        );
        return;
      }
      const presentation = renderSpecVerificationPanel(theme, active, spec.verify());
      ctx.ui.notify(presentation.panel, presentation.notification);
    },
  });

  pi.registerShortcut("ctrl+shift+g", {
    description: "Show active policy: preset, rules, audit status",
    handler: async (ctx) => {
      const policy = await requirePolicy(ctx);
      if (!policy) return;
      const theme = ctx.ui.theme;
      ctx.ui.notify(renderPolicyPanel(theme, policy), "info");
    },
  });

  pi.registerShortcut("ctrl+shift+a", {
    description: "Show last 10 audit log entries",
    handler: async (ctx) => {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const policy = await requirePolicy(ctx);
      if (!policy) return;
      const theme = ctx.ui.theme;
      if (!policy.audit.enabled) {
        ctx.ui.notify(
          "Audit logging is off for this policy preset.\nSet audit.enabled = true in harness.policy.json to enable it.",
          "warning",
        );
        return;
      }
      const auditPath = policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl");
      let raw: string;
      try {
        raw = await readFile(auditPath, "utf-8");
      } catch {
        ctx.ui.notify("No audit log yet.\nIt gets written on the first governed tool call.", "info");
        return;
      }
      const entries = raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-10)
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .filter((e): e is AuditEvent => e !== null);
      if (entries.length === 0) { ctx.ui.notify("Audit log is empty.", "info"); return; }
      ctx.ui.notify(renderAuditPanel(theme, entries), "info");
    },
  });

  pi.registerShortcut("ctrl+shift+r", {
    description: "Run a code review — spawns a heterogeneous critic jury",
    handler: async (ctx) => {
      if (isSubagent) {
        ctx.ui.notify("Code review is only available in the main session.", "warning");
        return;
      }
      ctx.ui.notify("Delegating code review to the heterogeneous jury…", "info");
      await pi.sendUserMessage(buildJuryPrompt(), { deliverAs: "followUp" });
    },
  });

  const designerGoalOptions = [
    "Implement UI changes — read the codebase, build components, cover all states",
    "Review UI code — check for accessibility gaps, missing states, AI slop patterns",
    "Audit design system — extract tokens, document inconsistencies, suggest consolidation",
  ];

  const runDesignerAgent = async (goal: string, ctx: ExtensionContext) => {
    if (isSubagent) {
      ctx.ui.notify("Designer is only available in the main session.", "warning");
      return;
    }
    ctx.ui.notify("Delegating to the designer subagent…", "info");
    // Route through the pi-subagents engine (unified delegation + rich render).
    await pi.sendUserMessage(
      `Use the \`subagent\` tool to run the \`designer\` agent on this task: ${goal}`,
      { deliverAs: "followUp" },
    );
  };

  pi.registerCommand("designer", {
    description: "Spawn the Designer subagent for UI/UX implementation, review, or design-system audit",
    getArgumentCompletions: (prefix) => {
      if (prefix.trim().length > 0) return null;
      return designerGoalOptions.map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const explicitGoal = args.trim();
      if (explicitGoal) {
        await runDesignerAgent(explicitGoal, ctx);
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("Pass a goal: /designer <goal>", "warning");
        return;
      }
      const goal = await ctx.ui.select("What should the designer do?", designerGoalOptions);
      if (!goal) return;
      await runDesignerAgent(goal, ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+d", {
    description: "Spawn designer — UI/UX implementation and review",
    handler: async (ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Pass a goal: /designer <goal>", "warning");
        return;
      }
      const goal = await ctx.ui.select("What should the designer do?", designerGoalOptions);
      if (!goal) return;
      await runDesignerAgent(goal, ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+y", {
    description: "Toggle yolo mode — bypass all permission checks",
    handler: async (ctx) => {
      if (permissions.yoloLocked) {
        ctx.ui.notify("Yolo is disabled by configuration.", "warning");
        return;
      }
      const theme = ctx.ui.theme;
      if (!permissions.isYolo) {
        const ok = await ctx.ui.confirm(
          "Enable Yolo Mode?",
          "All permission checks, policy rules, and confirmation prompts will be bypassed.\n" +
          "The agent will execute any tool without asking. Use in trusted environments only.",
        );
        if (!ok) return;
        permissions.setYolo(true);
        ctx.ui.setStatus("harness-yolo", theme.fg("error", "⚡ yolo"));
        ctx.ui.notify(
          formatPanel(theme, "Yolo Mode ON", [
            theme.fg("warning", "All permission checks are now bypassed."),
            theme.fg("dim", "Press Ctrl+Shift+Y again to restore normal behavior."),
          ], "warning"),
          "warning",
        );
      } else {
        permissions.setYolo(false);
        ctx.ui.setStatus("harness-yolo", undefined);
        ctx.ui.notify(formatPanel(theme, "Yolo Mode OFF", "Permission checks restored.", "dim"), "info");
      }
    },
  });

  // ── MCP cleanup on shutdown ────────────────────────────────────────

  pi.on("session_shutdown", () => {
    mcpManager?.disconnect();
  });
  // ── Spec classification + session reset on each prompt ─────────────
  pi.on("before_agent_start", async (event, ctx) => {
    ctx.ui.setHeader(undefined);
    permissions.clearSessionRules();  // clear deny rules from any prior rejection
    const isHarnessContinuation =
      event.prompt.includes(GATE_CONTINUE_SENTINEL) ||
      event.prompt.includes(GOAL_DIRECTIVE_SENTINEL);
    if (!isHarnessContinuation) {
      spec.startTurn(event.prompt, pi.getFlag("spec") === true);
    }
    lens.beginTurn();
    lens.setStatus(ctx);


    // ── Memory: inject hand-curated preferences ────────────────────
    // Read-only: entries come from deliberate edits to .harness/memory.json,
    // never from auto-capture. The old prompt-pattern capture path memorized
    // any prompt containing "do not" as a durable preference and replayed it
    // into later sessions — including a parent's "just delegate to the
    // reviewer", which caused reviewer→reviewer recursion in children.
    // Parent sessions only: a subagent's context is its task, not the
    // parent project's preference list.
    let injected: string | null = null;
    if (!isSubagent) {
      const { store, project } = projectMemory();
      const memories = store.query({ project, limit: 10 });
      injected = formatMemoriesForInjection(memories);
    }

    // Model router removed — /models command handles model selection

    // ── Auto-invoke: nudge the top-level agent to delegate proactively ──
    // Parent only — children must not recursively fan out. The per-agent
    // `description` frontmatter (~/.pi/agent/agents/*.md) is the routing signal.
    const delegationDirective = isSubagent ? "" :
      "Specialist subagents are available via the `subagent` tool. Before doing " +
      "non-trivial work yourself, call `subagent` with {action:\"list\"} to see the " +
      "available specialists, then PROACTIVELY delegate matching work: codebase " +
      "search/mapping → explore, planning → plan, implementation → build/worker, " +
      "code review → reviewer, second opinions → oracle, web/doc research → " +
      "researcher, UI/UX → designer, fast recon for handoff → scout. Prefer " +
      "delegating to a specialist over doing specialist work inline; use the " +
      "parallel/chain modes when tasks are independent or form a pipeline. " +
      "Read-only specialists cannot edit or run commands by design. " +
      "Do NOT pass timeoutMs/maxRuntimeMs when delegating — every agent has its " +
      "own maxExecutionTimeMs budget, and short caller timeouts kill healthy runs " +
      "mid-flight, wasting all their work. If you must bound a run, use at least " +
      "600000 (10 minutes).";

    // ── Auto-invoke: nudge the top-level agent to reach for skills ──
    // Pi core injects an <available_skills> block into the system prompt but
    // only softly ("use the read tool when it matches"). Non-Claude models
    // routinely ignore that hint, so restate it as a hard directive. Parent
    // only — subagents receive their curated skill set via pi-subagents.
    const skillsDirective = isSubagent ? "" :
      "Specialized skills are listed in the <available_skills> block of this " +
      "system prompt. Before doing non-trivial work, scan that block: if any " +
      "skill's description matches the task, `read` its SKILL.md file FIRST and " +
      "follow its instructions — do not improvise work a skill already covers. " +
      "Skills and specialist subagents are complementary: a skill gives you the " +
      "procedure to run inline; a subagent runs the work in fresh context. When " +
      "both fit, load the skill and delegate under its guidance.";

    // ── Goal mode: persistence rules for the whole active-goal turn ─────
    // Stands in the system prompt (not just the follow-up directive) so the
    // agent finishes more work per turn and stops less — fewer turns, fewer
    // evaluator calls, less chance of nearing the turn ceiling. Runs in
    // parent and subagent alike: isActive() is only ever true where a goal
    // was set (subagents don't drive the loop, but a directly-set goal there
    // still benefits from the persistence framing).
    const goalSnap = goalController.snapshot();
    const goalDirective = goalSnap?.status === "active"
      ? buildGoalSystemPrompt(goalSnap.condition)
      : "";

    const systemPrompt = [injected, delegationDirective, skillsDirective, goalDirective]
      .filter(Boolean)
      .join("\n\n");

    return systemPrompt ? { systemPrompt } : undefined;
  });

  // ── Permission + explicit-spec approval gate ───────────────────────
  pi.on("tool_call", async (event, ctx: ExtensionContext) => {
    const policyState = await policyStatePromise;
    if (policyState.kind === "error") {
      return { block: true, reason: `Policy configuration error: ${policyState.error}` };
    }
    // Overlay the delivery mode's policy ceiling onto the base policy. Overlay
    // rules are PREPENDED so they take precedence (mirrors narrowPolicyForAgent).
    // Resolved in both parent and subagents, so the overlay (e.g. local-only
    // push-deny) applies to child processes too. resolveDeliveryState is fail-safe.
    const overlay = await deliveryOverlayPromise;
    const policy = overlay.length
      ? { ...policyState.policy, rules: [...overlay, ...policyState.policy.rules] }
      : policyState.policy;
    const promptUser = (msg: string) => ctx.ui.confirm("Permission Required", msg);
    const approveSpec = (s: FormalSpec) =>
      ctx.ui.confirm("Spec Approval Required", formatSpecForApproval(s, ctx.ui.theme ?? noopTheme));
    const auditLogger = policy.audit.enabled
      ? new AuditLogger(policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl"))
      : undefined;

    // Autonomy: unattended trusts the policy ceiling (auto-approves prompts that
    // the ceiling already permits). Resolved in both parent and subagents: a child
    // of an unattended repo runs headless, while an attended/unregistered repo
    // falls back to "attended" so writer subagents fail closed (stall, no UI).
    const delivery = await deliveryStatePromise;

    // Argv-level push guard: catches `git <flags> push` forms (e.g.
    // `git -C dir push`) that the anchored globs in delivery-overlay.ts miss.
    // Applies regardless of autonomy, closing the local-only + unattended gap.
    if (shouldBlockLocalOnlyPush(delivery?.mode, event.toolName, event.input)) {
      return { block: true, reason: "local-only delivery mode forbids pushing to a remote (argv-level guard)" };
    }

    // Governed Tool Call: computed once per tool call and passed to every
    // consumer (permission handler, snapshot decision) — the single source
    // for capability, target, risk tier, and policy decision.
    const governed = evaluateGovernedToolCall(event.toolName, event.input, policy);

    const handler = makeBeforeToolHandler(
      permissions,
      spec,
      promptUser,
      ctx.hasUI,
      approveSpec,
      policy,
      auditLogger,
      { sessionId, agentType },
      delivery?.autonomy ?? "attended",
    );
    const result = await handler(event, governed);
    if (result?.block) return { block: true, reason: result.reason };

    const ctxGuardResult = contextModeExecutionGuard(event);
    if (ctxGuardResult?.block) return ctxGuardResult;

    const lensResult = await lens.beforeTool(event, ctx);
    if (lensResult?.block) return lensResult;

    if (!permissions.isYolo) {
      // Git snapshot: stash working tree before critical (mutating bash) tool
      // calls. Read-only bash is low-tier and skips this entirely.
      // Secret scanning is handled by Lens Lite, even when yolo is enabled.
      if (governed.call.riskTier === "critical") {
        createSnapshot(process.cwd()).catch(() => {});
      }
    }
  });

  // ── Spec output collection ─────────────────────────────────────────
  pi.on("tool_result", (event, ctx: ExtensionContext) => {
    return policyStatePromise.then((state) => {
      lens.afterTool(event, ctx);
      const auditLogger = state.kind === "ok" && state.policy.audit.enabled
        ? new AuditLogger(state.policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl"))
        : undefined;
      return makeAfterToolHandler(spec, auditLogger, { sessionId, agentType })(event);
    }).catch((err) => {
      console.error("[harness][tool_result]", err instanceof Error ? err.message : String(err));
      return undefined;
    });
  });

  pi.on("agent_end", async (event, ctx: ExtensionContext) => {
    // ESC must win over both continuation drivers below: an aborted turn ends
    // with a final assistant message whose stopReason is "aborted".
    const turnAborted = readAborted(event);
    const results = spec.finishTurn(event.messages, { aborted: turnAborted });
    if (results.length > 0) {
      const theme = ctx.ui.theme ?? noopTheme;
      const passed = results.filter((r) => r.passed).length;
      const lines = results.map((r) => `  ${r.passed ? theme.fg("success", "✓") : theme.fg("error", "✗")}  ${r.criterion.statement}`);
      const approvalNote =
        spec.activeSpec?.approvalStatus === "rejected"
          ? `\n${theme.fg("dim", "(spec was rejected)")}`
          : "";
      const hasFailures = passed !== results.length;
      const summaryHeader = !ctx.hasUI && hasFailures
        ? `${theme.bold(theme.fg("error", "Spec failed:"))}${approvalNote}`
        : `${theme.bold("Spec:")} ${theme.fg(hasFailures ? "warning" : "success", `${passed}/${results.length}`)} passed${approvalNote}`;

      const panel = formatPanel(theme, hasFailures ? "Spec Verification Failed" : "Spec Verification", lines, hasFailures ? "error" : "success");
      ctx.ui.notify(
        `${summaryHeader}\n${panel}`,
        hasFailures ? "warning" : "info",
      );

      // The gate defers to an active /goal (goalActive) so the two loops never
      // both queue a follow-up in the same turn — the goal evaluator is the
      // sole continuation driver while a goal is active.
      if (shouldReinject({
        results,
        attempts: spec.gateAttempts,
        isSubagent,
        enabled: !gateDisabledByEnv(),
        goalActive: goalController.isActive(),
        aborted: turnAborted,
      })) {
        const prompt = buildContinuationPrompt(results, spec.gateAttempts);
        const failedCriteria = results.filter((result) => !result.passed).map((result) => result.criterion.statement);
        await appendHarnessEvent({
          type: "gate_failure",
          taskId: sessionId,
          model: ctx.model?.id,
          summary: `verification gate re-injected ${failedCriteria.length} unmet criteria`,
          evidence: failedCriteria,
          outcome: "needs_work",
          createdAt: new Date().toISOString(),
        }).catch((err) => {
          console.error("[harness][evolution]", err instanceof Error ? err.message : String(err));
        });
        spec.recordGateAttempt();
        await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      }
    }

    // ── /goal loop ─────────────────────────────────────────────────────
    // Runs regardless of spec state. It is a no-op unless a goal is active,
    // and the gate above already deferred to it, so at most one follow-up is
    // queued per turn. The evaluator no longer runs here — completion is
    // signaled by the goal_complete tool (which confirms via the evaluator);
    // a work turn only advances the counter and re-prompts or pauses.
    await handleGoalAgentEnd({
      controller: goalController,
      sendDirective: async (directive) => { pi.sendUserMessage(directive, { deliverAs: "followUp" }); },
      notify: (message, level) => ctx.ui.notify(message, level ?? "info"),
      recordEvent: recordGoalEvent,
      getTokens: () => ctx.getContextUsage()?.tokens ?? 0,
      isSubagent,
    }, { willRetry: readWillRetry(event), aborted: turnAborted });
    ctx.ui.setStatus("harness-goal", renderGoalStatusSegment(goalController.snapshot()));
  });

  // ── Web search tool ────────────────────────────────────────────────
  // registerSearchTool removed — superseded by npm:pi-web-access

  if (!isSubagent) {
    // Legacy Thanos `task` tool — superseded by the pi-subagents `subagent` tool.
    // Kept dormant so it can be re-enabled with THANOS_LEGACY_TASK=1. The
    // executeTask stays imported solely for this dormant tool; /review and
    // /designer now route through the pi-subagents `subagent` engine instead.
    if (process.env.THANOS_LEGACY_TASK === "1") {
    pi.registerTool({
      name: "task",
      label: "Delegate to subagent",
      description: "Run a bounded specialist subagent task under the current policy ceiling.",
      parameters: TaskParamsSchema,
      async execute(_toolCallId, params: TaskParams, signal, onUpdate, toolCtx) {
        try {
          const policy = await requirePolicy(toolCtx);
          if (!policy) {
            return { content: [{ type: "text" as const, text: "Policy configuration error" }], isError: true, details: undefined };
          }
          const resolved = { ...params, type: params.type ?? defaultTaskType ?? await chooseTaskType(toolCtx.hasUI, toolCtx.ui) };
          const update = onUpdate
            ? (partial: { content: { type: "text"; text: string }[] }) => onUpdate({ ...partial, details: undefined })
            : undefined;
          const text = await _executeTask(resolved as TaskParams & { type: NonNullable<TaskParams["type"]> }, signal, update, policy, toolCtx.sessionManager?.getSessionId() || undefined);
          const contract = parseSubagentResult(text);
          if (needsClarification(contract)) {
            return {
              content: [{ type: "text" as const, text: `[clarification-needed] The subagent could not proceed without input. Surface this to the user via your ask tool before continuing.\n${text}` }],
              details: undefined,
            };
          }
          return { content: [{ type: "text" as const, text }], details: undefined };
        } catch (err) {
          return { content: [{ type: "text" as const, text: String(err) }], isError: true, details: undefined };
        }
      },
    });
    }

    pi.registerTool({
      name: "todo",
      label: "Manage todo state",
      description: "Track phased tasks with a single in-progress item and explicit export/import.",
      parameters: TodoParamsSchema,
      async execute(_toolCallId, params: TodoOperation) {
        try {
          if (params.op === "export") {
            return {
              content: [{ type: "text" as const, text: exportTodoMarkdown(todoState) }],
              details: makeTodoDetails(todoState),
            };
          }
          todoState = applyTodoOperation(todoState, params);
          return {
            content: [{ type: "text" as const, text: exportTodoMarkdown(todoState) }],
            details: makeTodoDetails(todoState),
          };
        } catch (err) {
          return { content: [{ type: "text" as const, text: String(err) }], isError: true, details: undefined };
        }
      },
      renderCall(args, theme) {
        return new Text(theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", String(args.op)), 0, 0);
      },
      renderResult(result, _opts, theme) {
        const details = result.details as TodoDetails | undefined;
        const state = details?.kind === "thanos-todo" ? details.state : EMPTY_TODO_STATE;
        return new Text(renderTodoLines(state, theme).join("\n"), 0, 0);
      },
    });

    pi.registerTool({
      name: "ask",
      label: "Ask structured question",
      description: "Ask the user one option-based question and return a governed decision record. Always set `recommended` to your strongest option (shown to the user, marked '(Recommended)' and listed first) and give each option a `description` explaining its trade-off. The user can type a free-text answer unless `allowOther` is false.",
      parameters: AskParamsSchema,
      async execute(_toolCallId, params: AskQuestion, _signal, _onUpdate, toolCtx) {
        try {
          const policyState = await policyStatePromise;
          if (policyState.kind === "error") {
            return { content: [{ type: "text" as const, text: `Policy configuration error: ${policyState.error}` }], isError: true, details: undefined };
          }
          const policy = policyState.policy;
          if (!toolCtx.hasUI) {
            const resolved = resolveHeadlessAsk(params, policy.preset);
            if (resolved.kind === "blocked") {
              return {
                content: [{ type: "text" as const, text: resolved.reason }],
                isError: true,
                details: undefined,
              };
            }
            const decision = buildAskDecision(params, resolved.selected, resolved.source);
            return { content: [{ type: "text" as const, text: JSON.stringify(decision) }], details: undefined };
          }

          // Order options with the recommended one first, then render label — description,
          // tagging the recommendation so the user can see it (Claude Code AskUserQuestion parity).
          const recommended = params.options.find((o) => o.id === params.recommended);
          const rest = params.options.filter((o) => o.id !== params.recommended);
          const ordered = recommended ? [recommended, ...rest] : [...params.options];
          const display = (o: { id: string; label: string; description?: string }) => {
            const base = o.description ? `${o.label} — ${o.description}` : o.label;
            return o.id === params.recommended ? `${base} (Recommended)` : base;
          };
          const rendered = ordered.map((o) => ({ id: o.id, text: display(o) }));

          // Free-text "Other" is offered by default; allowOther:false locks the choice set.
          const showOther = params.allowOther !== false;
          const OTHER_LABEL = "✎ Other (type your own answer…)";
          const choices = rendered.map((r) => r.text);
          if (showOther) choices.push(OTHER_LABEL);

          const picked = await toolCtx.ui.select(params.question, choices);
          if (!picked) {
            return { content: [{ type: "text" as const, text: "ask cancelled" }], isError: true, details: undefined };
          }

          if (showOther && picked === OTHER_LABEL) {
            const typed = await toolCtx.ui.input(params.question, "Type your answer");
            if (typed === undefined || typed.trim().length === 0) {
              return { content: [{ type: "text" as const, text: "ask cancelled" }], isError: true, details: undefined };
            }
            const decision = buildAskDecision(params, [typed.trim()], "user", undefined, true);
            return { content: [{ type: "text" as const, text: JSON.stringify(decision) }], details: undefined };
          }

          const match = rendered.find((r) => r.text === picked);
          if (!match) {
            return { content: [{ type: "text" as const, text: "ask cancelled" }], isError: true, details: undefined };
          }
          const decision = buildAskDecision(params, [match.id], "user");
          return { content: [{ type: "text" as const, text: JSON.stringify(decision) }], details: undefined };
        } catch (err) {
          return { content: [{ type: "text" as const, text: String(err) }], isError: true, details: undefined };
        }
      },
    });
  }

  if (isReviewer) {
    pi.registerTool({
      name: "report_finding",
      label: "Report review finding",
      description: "Record a structured review finding and return the aggregate review verdict.",
      parameters: FindingParamsSchema,
      async execute(_toolCallId, params, _signal, _onUpdate) {
        try {
          reviewFindings = addFinding(reviewFindings, params);
          return { content: [{ type: "text" as const, text: formatReviewSummary(reviewFindings) }], details: undefined };
        } catch (err) {
          return { content: [{ type: "text" as const, text: String(err) }], isError: true, details: undefined };
        }
      },
    });
  }

}
