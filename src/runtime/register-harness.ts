// src/index.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { PermissionManager } from "../permissions/manager";
import { yoloDisabledByEnv } from "../permissions/yolo-config";
import { SpecEngine } from "../spec/engine";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { GoalController } from "../goal/controller";
import { registerGoalCommand, renderGoalStatusSegment } from "../goal/command";
import { extractLastTurnFromBranch } from "../goal/extract";
import { runEvaluatorWith } from "../goal/evaluator";
import { confirmGoalCompletion } from "../goal/confirm";
import { loadEvaluatorOverride, loadGoalSettings } from "../goal/load-settings";
import { pickEvaluatorModel, resolveEvaluatorAuth } from "../goal/evaluator-model";
import { resolveGoalSettings } from "../goal/types";
import type { TaskParams } from "../agents/task-tool";
import { loadPolicyState } from "../policy/state";
import { registerSlashCommands } from "../commands/slash";
import { MCPManager } from "../mcp/manager";
// Model router removed — use /models command or pi-subagents for model selection
// registerSearchTool removed — superseded by npm:pi-web-access
import { AskParamsSchema, buildAskDecision, resolveHeadlessAsk, type AskQuestion } from "../interaction/ask";
import { FindingParamsSchema, addFinding, formatReviewSummary, type ReviewFinding } from "../review/findings";
import { LensLite, registerLensLiteCommand } from "../lens/lite";
import { appendHarnessEvent } from "../observability/harness-ledger";
import { detectChildRole, isSubagentProcess } from "../agents/child-role";
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
import { registerGovernanceHooks } from "./governance-hooks";
import { registerModelEvents } from "./model-events";


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

  // ── Spec classification + session reset on each prompt ─────────────
  registerBeforeAgentStart(pi, { sessionId, isSubagent, permissions, spec, lens, goalController });

  // ── Governed execution gate: tool_call (GovernanceRuntime.authorize()),
  // tool_result (spec output collection), agent_end (spec verification gate
  // + the /goal loop's per-turn advance) ───────────────────────────────
  registerGovernanceHooks(pi, {
    policyStatePromise,
    deliveryRuntime,
    childRole,
    spec,
    permissions,
    sessionId,
    agentType,
    lens,
    isSubagent,
    goalController,
    recordGoalEvent,
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
