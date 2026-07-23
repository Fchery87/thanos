// src/index.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join } from "node:path";

import { AuditLogger } from "../audit/logger";
import { PermissionManager } from "../permissions/manager";
import { gateDisabledByEnv, yoloDisabledByEnv } from "../permissions/yolo-config";
import { SpecEngine } from "../spec/engine";
import { buildContinuationPrompt, shouldReinject } from "../spec/gate";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { GoalController } from "../goal/controller";
import { registerGoalCommand, renderGoalStatusSegment } from "../goal/command";
import { handleAgentEnd as handleGoalAgentEnd } from "../goal/loop";
import { extractLastTurnFromBranch, readAborted, readWillRetry } from "../goal/extract";
import { runEvaluatorWith } from "../goal/evaluator";
import { confirmGoalCompletion } from "../goal/confirm";
import { loadEvaluatorOverride, loadGoalSettings } from "../goal/load-settings";
import { pickEvaluatorModel, resolveEvaluatorAuth } from "../goal/evaluator-model";
import { resolveGoalSettings } from "../goal/types";
import { makeAfterToolHandler } from "../hooks/after-tool";
import type { TaskParams } from "../agents/task-tool";
import { AGENT_TYPES } from "../agents/registry";
import { loadPolicyState } from "../policy/state";
import { registerSlashCommands } from "../commands/slash";
import { MCPManager } from "../mcp/manager";
import {
  formatSpecForApproval,
  formatPanel,
  noopTheme,
} from "../ui-utils";
// Model router removed — use /models command or pi-subagents for model selection
import { createSnapshot } from "../security/snapshot";
// registerSearchTool removed — superseded by npm:pi-web-access
import { AskParamsSchema, buildAskDecision, resolveHeadlessAsk, type AskQuestion } from "../interaction/ask";
import { FindingParamsSchema, addFinding, formatReviewSummary, type ReviewFinding } from "../review/findings";
import { LensLite, registerLensLiteCommand } from "../lens/lite";
import { appendHarnessEvent } from "../observability/harness-ledger";
import { detectChildRole, isSubagentProcess } from "../agents/child-role";
import { roleNarrowingOverlay } from "../governance/role-overlay";
import { GovernanceRuntime } from "./governance-runtime";
import { issueContinuation } from "./continuation-auth";
import { registerThinkingCommand } from "./commands/thinking";
import { registerModesCommand } from "./commands/modes";
import { registerTodoCommand, registerTodoTool, TodoRuntime } from "./commands/todo";
import { registerMemoryCommands } from "./commands/memory";
import { registerYoloCommand, registerYoloShortcut } from "./commands/yolo";
import { registerDeliveryCommand, DeliveryRuntime } from "./commands/delivery";
import { registerShipCommand } from "./commands/ship";
import { registerMcpCommand } from "./commands/mcp";
import { registerModelsCommand } from "./commands/models";
import { registerDesignerCommand } from "./commands/designer";
import { registerDiagnosticShortcuts } from "./shortcuts";
import { registerSessionStart } from "./session-start";
import { registerBeforeAgentStart } from "./before-agent-start";
import { registerModelEvents } from "./model-events";

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
  const policyStatePromise = loadPolicyState(process.cwd(), process.env.HARNESS_POLICY_FILE);
  // See DeliveryRuntime's constructor docblock for the subagent-remote-match
  // caveat and why resolution happens in both parent and child processes.
  const deliveryRuntime = new DeliveryRuntime(process.cwd());

  // ── MCP server management (main session only) ───────────────────────
  const mcpManager = isSubagent ? null : new MCPManager();

  registerSessionStart(pi, {
    todoRuntime,
    mcpManager,
    deliveryRuntime,
    permissions,
    lens,
    policyStatePromise,
    getDefaultTaskType: () => defaultTaskType,
    clearReviewFindings: () => { reviewFindings = []; },
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

  registerDiagnosticShortcuts(pi, {
    isSubagent,
    policyStatePromise,
    spec,
    permissions,
    getDefaultTaskType: () => defaultTaskType,
  });

  registerDesignerCommand(pi, isSubagent);

  registerYoloShortcut(pi, permissions);

  // ── MCP cleanup on shutdown ────────────────────────────────────────

  pi.on("session_shutdown", () => {
    mcpManager?.disconnect();
  });
  // ── Spec classification + session reset on each prompt ─────────────
  registerBeforeAgentStart(pi, { sessionId, isSubagent, permissions, spec, lens, goalController });

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
