// src/index.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join } from "node:path";

import { AuditLogger } from "../audit/logger";
import type { AuditEvent } from "../audit/types";
import { PermissionManager } from "../permissions/manager";
import { gateDisabledByEnv, yoloDisabledByEnv } from "../permissions/yolo-config";
import { SpecEngine } from "../spec/engine";
import { computeThinkingEscalation, NO_ESCALATION, type ThinkingEscalationState } from "./thinking-escalation";
import { buildContinuationPrompt, shouldReinject } from "../spec/gate";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { GoalController } from "../goal/controller";
import { registerGoalCommand, renderGoalStatusSegment } from "../goal/command";
import { handleAgentEnd as handleGoalAgentEnd } from "../goal/loop";
import { extractLastTurnFromBranch, readAborted, readWillRetry } from "../goal/extract";
import { runEvaluatorWith } from "../goal/evaluator";
import { buildGoalSystemPrompt } from "../goal/prompts";
import { confirmGoalCompletion } from "../goal/confirm";
import { loadEvaluatorOverride, loadGoalSettings } from "../goal/load-settings";
import { pickEvaluatorModel, resolveEvaluatorAuth } from "../goal/evaluator-model";
import { resolveGoalSettings } from "../goal/types";
import { makeAfterToolHandler } from "../hooks/after-tool";
import type { TaskParams } from "../agents/task-tool";
import { AGENT_TYPES } from "../agents/registry";
import { loadRoster } from "../agents/roster";
import { loadPolicyState } from "../policy/state";
import { readRepoId } from "../governance/delivery";
import { registerSlashCommands } from "../commands/slash";
import { MCPManager } from "../mcp/manager";
import { initializeMcpSession } from "../mcp/lifecycle";
import {
  formatValue,
  formatSpecForApproval,
  formatPanel,
  noopTheme,
} from "../ui-utils";
import { renderAuditPanel, renderPolicyPanel, renderSessionSnapshotPanel, renderSpecVerificationPanel } from "../commands/presenters";
import { renderWelcomeHeader, formatTimeAgo, type WelcomeMcpSummary, type WelcomePolicySummary } from "../welcome/header";
import { checkForUpdate } from "../welcome/update-check";
import { checkPatchDrift, formatPatchDriftWarning } from "../welcome/patch-drift";
import type { MemoryRecord } from "../memory/types";
// Model router removed — use /models command or pi-subagents for model selection
import { createSnapshot } from "../security/snapshot";
// registerSearchTool removed — superseded by npm:pi-web-access
import { AskParamsSchema, buildAskDecision, resolveHeadlessAsk, type AskQuestion } from "../interaction/ask";
import { FindingParamsSchema, addFinding, formatReviewSummary, type ReviewFinding } from "../review/findings";
import { buildJuryPrompt } from "../review/jury";
import { LensLite, registerLensLiteCommand } from "../lens/lite";
import { appendHarnessEvent } from "../observability/harness-ledger";
import { detectChildRole, isSubagentProcess } from "../agents/child-role";
import { roleNarrowingOverlay } from "../governance/role-overlay";
import { GovernanceRuntime } from "./governance-runtime";
import { assemblePrompt } from "../context/broker";
import { consumeContinuation, issueContinuation } from "./continuation-auth";
import { registerThinkingCommand } from "./commands/thinking";
import { registerModesCommand } from "./commands/modes";
import { registerTodoCommand, registerTodoTool, TodoRuntime } from "./commands/todo";
import { registerMemoryCommands, projectMemory } from "./commands/memory";
import { registerYoloCommand, registerYoloShortcut } from "./commands/yolo";
import { registerDeliveryCommand, DeliveryRuntime } from "./commands/delivery";
import { registerShipCommand } from "./commands/ship";
import { registerMcpCommand } from "./commands/mcp";
import { registerModelsCommand } from "./commands/models";
import { registerModelEvents } from "./model-events";
import { getSupportedLevels, setThinkingStatus, type ThinkingLevel } from "./thinking-levels";

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


export function registerHarness(pi: ExtensionAPI, deps?: { initialYolo?: boolean }) {
  // PI_SUBAGENT_CHILD is set by the pi-subagents engine for every child it
  // spawns. Without checking it, children get the parent-only delegation
  // directive and recursively re-delegate (a reviewer spawning a reviewer)
  // instead of doing their own work, idling until their budget kills them.
  // See src/agents/child-role.ts for the full legacy vs. live env contract.
  const isSubagent = isSubagentProcess(process.env);
  // Precise live-roster role name (e.g. "reviewer-security", "explore"),
  // undefined in the parent session and for the legacy path's generic "1"
  // marker. Drives roleNarrowingOverlay below — undefined naturally yields no
  // narrowing, which is exactly right for a parent session.
  const childRole = detectChildRole(process.env);
  const sessionId = crypto.randomUUID();
  const agentType = isSubagent ? "subagent" : "parent" as const;
  let defaultTaskType: TaskParams["type"] | undefined;
  const todoRuntime = new TodoRuntime();
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
  // Thinking escape hatch: /goal and --spec run at the model's max, restored when
  // neither is active. State persists across turns (parent session only).
  let thinkingEscalation: ThinkingEscalationState = NO_ESCALATION;
  const policyStatePromise = loadPolicyState(process.cwd(), process.env.HARNESS_POLICY_FILE);
  // See DeliveryRuntime's constructor docblock for the subagent-remote-match
  // caveat and why resolution happens in both parent and child processes.
  const deliveryRuntime = new DeliveryRuntime(process.cwd());

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
    todoRuntime.reconstructFrom(ctx.sessionManager.getBranch());
    ctx.ui.setStatus("harness-todo", todoRuntime.statusSegment(ctx));
    if (!mcpManager) return;

    const theme = ctx.ui.theme;

    // session_start is parent-only (the `if (!mcpManager) return` guard above).
    // If the registry locks yolo, enforce it here too — idempotent with the
    // env-based lock applied at construction.
    const delivery = await deliveryRuntime.getState();
    if (delivery?.yoloLocked) permissions.lockYolo();

    // Show yolo/lens status if default-on
    if (permissions.isYolo) {
      ctx.ui.setStatus("harness-yolo", theme.fg("error", "⚡ yolo"));
    }
    lens.setStatus(ctx);

    // Delivery mode status segment (autonomy shown only when unattended).
    if (delivery) {
      ctx.ui.setStatus("harness-delivery", theme.fg("accent", DeliveryRuntime.statusLabel(delivery)));
    }

    // ── First-launch delivery selector ─────────────────────────────────
    // An unregistered repo resolves to the safe default (local-only/attended).
    // When a human is present, offer to register it in the trusted captain
    // registry — the interactive counterpart of hand-editing projects.json.
    // Every non-interactive path (ESC, no UI, subagent — excluded above by the
    // mcpManager guard) keeps the fail-closed default untouched.
    if (delivery && !delivery.registered && ctx.hasUI) {
      try {
        const repoId = await readRepoId(process.cwd());
        const mode = await deliveryRuntime.promptMode(ctx, repoId.remote ?? repoId.path);
        if (mode) {
          await deliveryRuntime.applySelection(ctx, mode, permissions);
        } else {
          ctx.ui.notify(
            "Keeping the safe default (local-only). Run /delivery to register this project later.",
            "info",
          );
        }
      } catch (err) {
        ctx.ui.notify(
          `Delivery selector failed: ${err instanceof Error ? err.message : String(err)}`,
          "warning",
        );
      }
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

      // Non-blocking pi-subagents patch-drift check. A package update can
      // silently revert the two Thanos source patches (see
      // scripts/patch-pi-subagents.mjs), and the first symptom is the fanout
      // double-registration crash resurfacing unexplained on a reviewer run.
      // Silent when pi-subagents isn't installed or both patches are intact.
      checkPatchDrift().then((result) => {
        const warning = formatPatchDriftWarning(result);
        if (warning) ctx.ui.notify(warning, "warning");
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
    todoRuntime.reconstructFrom(ctx.sessionManager.getBranch());
    ctx.ui.setStatus("harness-todo", todoRuntime.statusSegment(ctx));
  });

  // ── --spec flag ────────────────────────────────────────────────────
  pi.registerFlag("spec", {
    type: "boolean",
    default: false,
    description: "Require approval before first edit/exec when task is ambient",
  });

  registerModesCommand(pi, {
    getDefaultTaskType: () => defaultTaskType,
    setDefaultTaskType: (type) => { defaultTaskType = type; },
  });

  registerTodoCommand(pi, todoRuntime);

  // ── /remember + /memory — hand-curated project preferences ────────
  // Parent sessions only, so a subagent can never plant a memory.
  if (!isSubagent) {
    registerMemoryCommands(pi);
  }

  // ── /yolo — bypass all permission checks ──────────────────────────
  registerYoloCommand(pi, { permissions, getDeliveryState: () => deliveryRuntime.getState() });

  // ── /delivery — choose this project's delivery mode (persisted) ──
  registerDeliveryCommand(pi, { isSubagent, runtime: deliveryRuntime, permissions });

  // ── /ship — deliver the current branch per the resolved delivery mode ──

  registerShipCommand(pi, { isSubagent, runtime: deliveryRuntime });

  // ── /mcp — MCP server lifecycle management ───────────────────────
  registerMcpCommand(pi, { isSubagent, mcpManager });

  // ── Thinking level selector (command + ctrl+shift+k shortcut) ──────
  registerThinkingCommand(pi);

  // ── Model-lifecycle hooks: auto-prompt thinking level on model switch,
  // keep status bar in sync with Shift+Tab cycles ────────────────────
  registerModelEvents(pi);

  // ── /models — two-step provider→model selector ───────────────────
  registerModelsCommand(pi);

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

        // Out-of-band completions bypass pi's request path, so auth must be
        // resolved through the registry (auth.json, $ENV refs, OAuth) — a bare
        // completeSimple only finds well-known env keys for builtin providers
        // and resolves (not rejects!) with stopReason "error" for the rest.
        const completeAuthed = async (model: NonNullable<typeof primary>, context: Parameters<typeof completeSimple>[1], reasoning?: string) => {
          const auth = await resolveEvaluatorAuth(toolCtx.modelRegistry, model);
          return completeSimple(model, context, { reasoning: (reasoning ?? "low") as "low", ...auth });
        };

        // Retry once on the session model (routing may point at a flaky
        // provider); confirmGoalCompletion owns the fail-closed + fail-safe policy.
        const verdict = await confirmGoalCompletion(
          { condition: snap.condition, previousReason: snap.lastReason, summary: params.summary, evidence },
          (input) => runEvaluatorWith((context) => completeAuthed(primary, context, routed?.thinking), input),
          (input) => runEvaluatorWith((context) => completeAuthed(toolCtx.model ?? primary, context), input),
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
  // ctrl+shift+k (select thinking level) is registered by
  // registerThinkingCommand above, alongside the /thinking command it mirrors.

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

  registerYoloShortcut(pi, permissions);

  // ── MCP cleanup on shutdown ────────────────────────────────────────

  pi.on("session_shutdown", () => {
    mcpManager?.disconnect();
  });
  // ── Spec classification + session reset on each prompt ─────────────
  pi.on("before_agent_start", async (event, ctx) => {
    ctx.ui.setHeader(undefined);
    permissions.clearSessionRules();  // clear deny rules from any prior rejection
    const isHarnessContinuation =
      consumeContinuation(sessionId, "spec", event.prompt) ||
      consumeContinuation(sessionId, "goal", event.prompt);
    if (!isHarnessContinuation) {
      spec.startTurn(event.prompt, pi.getFlag("spec") === true);
    }
    lens.beginTurn();
    lens.setStatus(ctx);

    // ── Thinking escape hatch: /goal and --spec run at the model's max ──
    // Parent only. High-assurance work overrides the medium default and restores
    // the user's baseline the moment neither a goal nor --spec is active.
    if (!isSubagent) {
      const model = ctx.model;
      const supportedLevels = model?.reasoning ? getSupportedLevels(model) : [];
      const escalation = computeThinkingEscalation({
        active: goalController.snapshot()?.status === "active" || pi.getFlag("spec") === true,
        supportedLevels,
        current: pi.getThinkingLevel() as string | undefined,
        state: thinkingEscalation,
      });
      thinkingEscalation = escalation.state;
      if (escalation.setLevel !== undefined) {
        pi.setThinkingLevel(escalation.setLevel as ThinkingLevel);
        setThinkingStatus(pi, ctx);
      }
    }

    // ── Memory: inject hand-curated preferences ────────────────────
    // Read-only: entries come from deliberate edits to .harness/memory.json,
    // never from auto-capture. The old prompt-pattern capture path memorized
    // any prompt containing "do not" as a durable preference and replayed it
    // into later sessions — including a parent's "just delegate to the
    // reviewer", which caused reviewer→reviewer recursion in children.
    // Parent sessions only: a subagent's context is its task, not the
    // parent project's preference list.
    let memories: MemoryRecord[] = [];
    if (!isSubagent) {
      const { store, project } = projectMemory();
      memories = store.query({ project, limit: 10 });
    }

    // Model router removed — /models command handles model selection

    // ── Auto-invoke: keep the top-level agent inline-first ──
    // Parent only — children must not recursively fan out. The per-agent
    // `description` frontmatter (~/.pi/agent/agents/*.md) is the routing signal,
    // so the roster is injected here verbatim instead of instructing the model
    // to call `subagent {action:"list"}` — that instruction made it re-list the
    // roster on every prompt, burning ~700 transcript tokens per turn for
    // information that is static within a session.
    //
    // The directive is inline-FIRST on purpose: a specialist run spins up a
    // fresh cold-started child (seconds of startup, often minutes of wall-clock),
    // so reflexively delegating ordinary work makes the session slower, not
    // smarter. Delegate only when it genuinely pays.
    const roster = isSubagent ? [] : await loadRoster();
    const promptAssembly = assemblePrompt({
      isSubagent,
      memories,
      roster,
      goalCondition: goalController.snapshot()?.status === "active" ? goalController.snapshot()?.condition : undefined,
      trustedInstructions: isSubagent ? [] : [
        "Specialist subagents are available via the `subagent` tool.",
        "Do non-trivial work inline yourself by default — you are a capable generalist and inline work has no cold-start cost. Delegate to a specialist ONLY when the work is genuinely parallel (independent slices worth running at once), needs a capability you lack, or the user explicitly asked for deep review or /waves. A specialist run cold-starts a fresh child (seconds to load, often minutes of wall-clock), so reflexive delegation of ordinary work makes the session slower, not smarter.",
        "When you do delegate independent or pipelined tasks, use the parallel/chain modes.",
        "Read-only specialists cannot edit or run commands by design.",
        "Do NOT pass timeoutMs/maxRuntimeMs when delegating — every agent has its own maxExecutionTimeMs budget, and short caller timeouts kill healthy runs mid-flight, wasting all their work. If you must bound a run, use at least 600000 (10 minutes).",
      ],
    });

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
      "A skill gives you a procedure to run inline; by default run it inline " +
      "yourself. Delegating skill-guided work to a subagent is only worth the " +
      "cold-start when the work is independent/parallel or genuinely needs fresh context.";

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

    const systemPrompt = [
      promptAssembly.trustedInstructions,
      skillsDirective,
      goalDirective,
      promptAssembly.contextMessage ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return systemPrompt ? { systemPrompt } : undefined;
  });

  // ── Governed execution gate: GovernanceRuntime.authorize() owns
  // policy construction, egress, push guard, permission evaluation,
  // yolo rules, audit recording, and snapshot decisions.
  pi.on("tool_call", async (event, ctx: ExtensionContext) => {
    const policyState = await policyStatePromise;
    if (policyState.kind === "error") {
      return { block: true, reason: `Policy configuration error: ${policyState.error}` };
    }

    const overlay = [...roleNarrowingOverlay(childRole), ...(await deliveryRuntime.getOverlay())];
    const effectivePolicy = overlay.length
      ? { ...policyState.policy, rules: [...overlay, ...policyState.policy.rules] }
      : policyState.policy;

    const delivery = await deliveryRuntime.getState();

    // Explicit-spec approval gate: fires before governance runtime
    const active = spec.activeSpec;
    if (active?.approvalStatus === "pending") {
      if (!ctx.hasUI) {
        return { block: true, reason: "Explicit spec needs approval but no UI available" };
      }
      const approved = await ctx.ui.confirm(
        "Spec Approval Required",
        formatSpecForApproval(active, ctx.ui.theme ?? noopTheme),
      );
      if (approved) {
        active.approvalStatus = "approved";
      } else {
        active.approvalStatus = "rejected";
        permissions.remember("*", "*", "deny");
        return { block: true, reason: `User rejected spec: ${active.goal}` };
      }
    }

    // An approved explicit spec narrows the session to its allowed capabilities.
    // (A pending spec is handled by the approval gate above; a rejected one has
    // already remembered a global deny.) The scope is enforced inside authorize.
    const specScope =
      active?.tier === "explicit" ? active.allowedCapabilities : undefined;

    const gov = new GovernanceRuntime({
      policy: effectivePolicy,
      permissions,
      yolo: permissions.isYolo,
      autonomy: delivery?.autonomy ?? "attended",
      deliveryMode: delivery?.mode,
      childRole,
      specScope,
      hasUI: ctx.hasUI,
      sessionId,
      agentType,
      recordAudit: async (e) => {
        const auditLogger = effectivePolicy.audit.enabled
          ? new AuditLogger(effectivePolicy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl"))
          : undefined;
        return auditLogger?.record(e);
      },
      promptUser: (msg: string) => ctx.ui.confirm("Permission Required", msg),
    });

    const decision = await gov.authorize(event.toolName, event.input);
    if (decision.block) {
      return { block: true, reason: decision.reason ?? "governance block" };
    }

    // Post-governance checks: context mode guard and LensLite
    const ctxGuardResult = contextModeExecutionGuard(event);
    if (ctxGuardResult?.block) return ctxGuardResult;

    const lensResult = await lens.beforeTool(event, ctx);
    if (lensResult?.block) return lensResult;

    // Snapshot for critical operations (governance signaled the need). This
    // runs under yolo too: authorize() sets snapshotNeeded for critical ops even
    // when yolo is on, preserving the pre-critical rollback point when prompts
    // are bypassed.
    if (decision.snapshotNeeded) {
      await createSnapshot(process.cwd());
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
        issueContinuation(sessionId, "spec", prompt);
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
      issueContinuation: (directive) => { issueContinuation(sessionId, "goal", directive); },
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
    // THANOS_LEGACY_TASK was the gate for the dormant Thanos `task` tool
    // (superseded by pi-subagents `subagent` engine). It has been removed
    // as of the Phenomenal Harness program; use subagent delegation instead.
    if (process.env.THANOS_LEGACY_TASK === "1") {
      console.warn(
        "[harness] THANOS_LEGACY_TASK=1 is no longer supported. " +
        "The legacy `task` tool has been removed. Use the `subagent` tool from pi-subagents for delegation."
      );
    }

    registerTodoTool(pi, todoRuntime);

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

  // Registered for every subagent process, not just reviewer roles: several
  // live roster agents (reviewer, reviewer-correctness, reviewer-security,
  // reviewer-tests, evaluator) list report_finding in their frontmatter tool
  // set, and per-agent exposure is already governed by that list (pi-subagents
  // filters registered tools down to it) — narrowing the registration itself
  // to one legacy-only role left every live one calling a tool that was never
  // registered in their process.
  if (isSubagent) {
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
