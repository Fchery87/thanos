import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AuditEvent } from "../audit/types";
import type { PermissionManager } from "../permissions/manager";
import { buildToolContractSnapshot } from "../governance/tool-contract";
import type { PolicyLoadState } from "../policy/state";
import type { SpecEngine } from "../spec/engine";
import type { GoalSnapshot } from "../goal/types";
import { buildContinueDirective as buildGoalContinueDirective } from "../goal/prompts";
import { RunFactRecorder, type RunFactInput } from "../execution/facts";
import type { RunFact } from "../execution/types";
import { currentRunProjection, formatRunProjection } from "./run";
import { handleSubagentModelsCommand } from "../agents/model-routing";
import { formatLabel, formatValue, formatPanel, makeTerminalSafeOptions, noopTheme, sanitizeTerminalText } from "../ui-utils";
import {
  renderAuditPanel, renderPolicyPanel, renderSessionSnapshotPanel,
  renderSpecVerificationPanel, renderToolContractPanel,
} from "../commands/presenters";
import {
  buildIntegrationDirective,
  createWorkflowRunner,
  formatWorkflowOutcome,
  planWavesWorkflow,
  workflowEvidenceRefs,
} from "../workflows/runtime";
import { parseWavesCommand } from "../workflows/command";
import { WORKFLOW_JOURNAL_ENTRY, type WorkflowRuntime, type WorkflowSnapshot } from "../workflows/state";
import type { WavePlan, WorkflowModule, WorkflowRunResult } from "../workflows/types";
import { approvePendingWorkContract } from "../runtime/work-contract-approval";
import { snapshotWorkingTree } from "../spec/diff-evidence";
import { issueContinuation } from "../runtime/continuation-auth";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";



function fmtN(n: number): string {
  return n.toLocaleString();
}

function formatWavesStatus(snapshot: WorkflowSnapshot | undefined): string {
  if (!snapshot) return "Waves — no workflow on the active session branch.";
  const active = snapshot.phase === "paused" ? snapshot.resume : snapshot;
  const counters = "integrationTurns" in active
    ? ` · integration ${active.integrationTurns}/${active.plan.integration.limits.maxIntegrationTurns} · jury ${active.juryRounds}/${active.plan.integration.limits.maxJuryRounds}`
    : "";
  const reason = "reason" in snapshot ? `\n  reason: ${snapshot.reason}` : "";
  return `Waves ${snapshot.phase} — ${snapshot.goal}${counters}${reason}`;
}

function buildResumeDirective(
  workflow: Extract<WorkflowSnapshot, { phase: "integrating" }>,
): string {
  return [
    "[harness:waves-integrate] Resume the approved Waves integration.",
    `Goal: ${workflow.goal}`,
    `Write only within: ${workflow.plan.integration.targetRoots.join(", ")}`,
    `Integration turns consumed: ${workflow.integrationTurns}/${workflow.plan.integration.limits.maxIntegrationTurns}.`,
    ...(workflow.correction
      ? ["Pending structured jury corrections:", workflow.correction]
      : []),
    "When this exact repository revision is ready for jury review, call workflow_yield.",
  ].join("\n");
}

export function registerSlashCommands(
  pi: ExtensionAPI,
  opts: {
    permissions: PermissionManager;
    spec: SpecEngine;
    policyPromise: Promise<PolicyLoadState>;
    isSubagent: boolean;
    sessionId: string;
    workflowRuntime: WorkflowRuntime;
    workflowModule: WorkflowModule;
    getGoal: () => GoalSnapshot | undefined;
    /**
     * Whether a /goal is running. `/spec` needs it for the same reason
     * `agent_end` does: while a goal is active the verify gate stands down
     * (`gate.ts` returns false on `goalActive`), so the criteria are reported
     * but not enforced. Without this, `/spec` renders them as gating during the
     * exact window in which they are not.
     */
    isGoalActive: () => boolean;
    getRunFacts?: () => readonly RunFact[];
    recordRunFact?: (fact: RunFactInput) => void;
  },
): void {
  const {
    permissions, spec, policyPromise, isGoalActive, isSubagent,
    sessionId, workflowRuntime, workflowModule, getGoal, recordRunFact,
  } = opts;
  const factRecorder = new RunFactRecorder(sessionId);
  const runFacts = (): readonly RunFact[] => opts.getRunFacts?.() ?? factRecorder.snapshot();
  const recordFact = (fact: RunFactInput): void => {
    if (recordRunFact) recordRunFact(fact);
    else factRecorder.record(fact);
  };

  pi.registerCommand("run", {
    description: "Show the observed execution projection for this session.",
    handler: async (args, ctx) => {
      if (isSubagent) {
        ctx.ui.notify("Run status is only available in the main session.", "warning");
        return;
      }
      if (args.trim() !== "" && args.trim() !== "status") {
        ctx.ui.notify("Usage: /run [status]", "warning");
        return;
      }
      ctx.ui.notify(formatRunProjection(currentRunProjection({
        facts: runFacts(),
        goal: getGoal(),
        workflow: workflowRuntime.current,
      })), "info");
    },
  });

  // Browse all loaded skills in one place.
  pi.registerCommand("skills", {
    description: "List all loaded skills with their descriptions.",
    handler: async (_args, ctx) => {
      const theme = ctx.ui.theme;
      const allCommands = pi.getCommands();
      const skills = allCommands.filter(c => c.source === "skill");

      if (skills.length === 0) {
        ctx.ui.notify(formatPanel(theme, "Skills", theme.fg("dim", "No skills loaded."), "dim"), "info");
        return;
      }

      const lines = skills.map(s =>
        `  ${theme.fg("accent", ("/" + s.name).padEnd(24, " "))} ${theme.fg("dim", s.description ?? "")}`,
      );
      ctx.ui.notify(formatPanel(theme, `Skills (${skills.length})`, lines, "dim"), "info");
    },
  });

  // ── /context ──────────────────────────────────────────────────────────────
  // You can't manage what you can't measure.
  pi.registerCommand("context", {
    description: "Show token count and window fill % for the active model.",
    handler: async (_args, ctx) => {
      const usage = ctx.getContextUsage();
      const theme = ctx.ui.theme;
      if (!usage) {
        ctx.ui.notify("No context data yet. Send a message first.", "warning");
        return;
      }
      const { tokens, contextWindow, percent } = usage;
      const tokStr = tokens !== null ? fmtN(tokens) : "unknown";
      const pctRaw = percent !== null ? Math.round(percent * 100) : null;
      const pctStr = pctRaw !== null ? `${pctRaw}%` : "?%";
      const windowK = Math.round(contextWindow / 1000);
      const warn = pctRaw !== null && pctRaw > 80;
      const hint = warn ? `\n${theme.fg("warning", "You're above 80%. Run /compact before the window fills.")}` : "";

      const content = `${formatLabel(theme, "Context:", 10)} ${formatValue(theme, tokStr, "accent")} tokens ${theme.fg("dim", "—")} ${warn ? theme.fg("warning", pctStr) : theme.fg("success", pctStr)} of ${windowK}k window${hint}`;
      const panel = formatPanel(theme, "Context Window", content, warn ? "warning" : "dim");
      ctx.ui.notify(panel, warn ? "warning" : "info");
    },
  });

  // ── /policy ───────────────────────────────────────────────────────────────
  // What the agent is allowed to do — and what it isn't.
  pi.registerCommand("policy", {
    description: "Show active policy: preset, rule counts, audit status, and headless default.",
    handler: async (_args, ctx) => {
      const policyState = await policyPromise;
      const theme = ctx.ui.theme;
      if (policyState.kind === "error") {
        ctx.ui.notify(formatPanel(theme, "Policy Error", policyState.error, "error"), "warning");
        return;
      }
      ctx.ui.notify(renderPolicyPanel(theme, policyState.policy), "info");
    },
  });

  // ── /tools ────────────────────────────────────────────────────────────────
  // What the agent sees — and what the policy says about each one. The tool
  // surface/classification comes from buildToolContractSnapshot (the same
  // projection /doctor and docs/reference.md use); only the live policy
  // disposition is evaluated here, since that decision stays owned by
  // PermissionManager, not by the read-only contract.
  pi.registerCommand("tools", {
    description: "List active tools with their policy disposition: allow, ask, or deny.",
    handler: async (_args, ctx) => {
      const theme = ctx.ui.theme;
      const snapshot = buildToolContractSnapshot({
        tools: pi.getAllTools(),
        activeToolNames: pi.getActiveTools(),
      });

      if (snapshot.entries.length === 0) {
        ctx.ui.notify("No tools registered yet.", "warning");
        return;
      }

      const panel = renderToolContractPanel(theme, snapshot, (capability, toolName) =>
        permissions.evaluate(capability, toolName));
      ctx.ui.notify(panel, "info");
    },
  });

  // ── /spec ─────────────────────────────────────────────────────────────────
  // What the agent agreed to do this turn — and whether it's done it.
  pi.registerCommand("spec", {
    description: "Show the current spec: goal, tier, criteria, and verification state.",
    handler: async (_args, ctx) => {
      const active = spec.activeSpec;
      const theme = ctx.ui.theme;
      if (!active) {
        ctx.ui.notify(
          "No active spec.\nSpecs generate on ambient and explicit tasks — not instant reads.",
          "info",
        );
        return;
      }
      const presentation = renderSpecVerificationPanel(theme, active, spec.verify(), { goalActive: isGoalActive() });
      ctx.ui.notify(presentation.panel, presentation.notification);
    },
  });

  const returnContinuationToGoal = async (): Promise<void> => {
    const goal = getGoal();
    if (!goal || goal.status !== "active") return;
    const directive = buildGoalContinueDirective();
    spec.startTurn(goal.condition, true);
    spec.turnBaseline = snapshotWorkingTree(process.cwd()).catch(() => undefined);
    issueContinuation(sessionId, "goal", directive);
    await pi.sendUserMessage(directive, { deliverAs: "followUp" });
  };

  const authorizeWorkflowPlan = async (
    plan: WavePlan,
    ctx: ExtensionCommandContext,
    options: { bindJournalPlan: boolean },
  ): Promise<boolean> => {
    const workflowGoal = workflowRuntime.current?.goal ?? plan.goal;
    if (
      !spec.activeSpec
      || spec.activeSpec.tier !== "explicit"
      || spec.activeSpec.goal !== workflowGoal
    ) {
      spec.startTurn(workflowGoal, true);
    }
    await spec.settleContract();
    if (options.bindJournalPlan) workflowRuntime.bindPlan(plan);
    spec.bindWorkflowPlan(plan);
    const identity = ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId();
    if (!identity) {
      workflowRuntime.pause("session_identity_unavailable");
      ctx.ui.notify("Waves paused because the current Pi session identity is unavailable.", "warning");
      if (workflowRuntime.current.mode === "goal_attached") await returnContinuationToGoal();
      return false;
    }
    const approval = await approvePendingWorkContract(spec, {
      repoDir: ctx.cwd,
      runId: identity,
      hasUI: ctx.hasUI,
      theme: ctx.ui.theme ?? noopTheme,
      confirm: (title, message) => ctx.ui.confirm(title, message),
    });
    if (!approval.approved) {
      const { reason } = approval as { approved: false; reason: string };
      if (workflowRuntime.current?.phase !== "paused") workflowRuntime.pause(reason);
      ctx.ui.notify(`Waves paused — ${reason}.`, "warning");
      if (workflowRuntime.current?.mode === "goal_attached") await returnContinuationToGoal();
      return false;
    }
    if (workflowRuntime.current?.phase === "awaiting_approval") workflowRuntime.approve();
    spec.turnBaseline = spec.runGrant
      ? Promise.resolve(new Map(spec.runGrant.baseline))
      : snapshotWorkingTree(ctx.cwd).catch(() => undefined);
    return true;
  };

  const investigateWorkflow = async (
    plan: WavePlan,
    ctx: ExtensionCommandContext,
  ): Promise<WorkflowRunResult> => {
    const current = workflowRuntime.current;
    if (current?.phase !== "investigating") {
      return { state: "invalid_plan", results: [], reasons: ["Waves is not investigating"] };
    }
    const completedNodeIds = new Set(current.acceptedEvidence.map((reference) => reference.nodeId));
    const result = await (await createWorkflowRunner(
      pi,
      ctx,
      ctx.signal,
      current.acceptedEvidence,
      (node, outcome) => {
        const attempt = (current.nodeAttempts[node.id] ?? 0) + 1;
        const workflowId = current.workflowId;
        if (outcome.state === "accepted") {
          recordFact({
            kind: "delegation_settled",
            nodeId: node.id,
            attempt,
            state: "accepted",
            requestId: outcome.envelope.requestId,
            workflowId,
          });
        } else if (outcome.state === "awaiting_evidence") {
          recordFact({
            kind: "delegation_settled",
            nodeId: node.id,
            attempt,
            state: "awaiting_evidence",
            reason: outcome.reasons.join("; "),
            workflowId,
          });
        } else {
          recordFact({
            kind: "delegation_settled",
            nodeId: node.id,
            attempt,
            state: "failed",
            reason: outcome.reason,
            workflowId,
          });
        }
      },
    )).run(plan, { completedNodeIds });

    const references = workflowEvidenceRefs(result);
    workflowRuntime.recordInvestigationProgress(
      references,
      result.results.map(({ node }) => node.id),
    );
    if (result.state === "completed") {
      workflowRuntime.completeInvestigation([]);
    } else {
      workflowRuntime.pause(result.reasons.join("; ") || "investigation_failed");
      if (workflowRuntime.current?.mode === "goal_attached") await returnContinuationToGoal();
    }
    return result;
  };

  const queueIntegration = async (
    plan: WavePlan,
    result: WorkflowRunResult,
    ctx: ExtensionCommandContext,
  ): Promise<void> => {
    const current = workflowRuntime.current;
    if (current?.phase !== "integrating") {
      throw new Error("Waves stopped because the approved workflow state could not be reconstructed");
    }
    const directive = buildIntegrationDirective(plan, result, current.acceptedEvidence);
    issueContinuation(sessionId, "waves", directive);
    await pi.sendUserMessage(directive, { deliverAs: "followUp" });
    ctx.ui.notify("Investigation accepted. Integration Owner continuation queued.", "info");
  };

  const executePlanning = async (
    goal: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> => {
    if (!spec.activeSpec) spec.startTurn(goal, true);
    const planning = await planWavesWorkflow(pi, ctx, goal, ctx.signal);
    if (planning.state !== "planned") {
      if (workflowRuntime.current?.phase === "planning") {
        workflowRuntime.pause(planning.reasons.join("; ") || "planning_failed");
        if (workflowRuntime.current.mode === "goal_attached") await returnContinuationToGoal();
      }
      ctx.ui.notify(`${planning.state}: ${planning.reasons.join("; ")}`, "warning");
      return;
    }
    if (!await authorizeWorkflowPlan(planning.plan, ctx, { bindJournalPlan: true })) return;
    const result = await investigateWorkflow(planning.plan, ctx);
    if (result.state !== "completed") {
      ctx.ui.notify(formatWorkflowOutcome(result), "warning");
      return;
    }
    await queueIntegration(planning.plan, result, ctx);
  };

  // ── /waves ────────────────────────────────────────────────────────────────
  // Explicit opt-in bounded orchestration over the public Delegation Authority
  // protocol. Missing evidence stops the graph; it never falls back to a prompt.
  pi.registerCommand("waves", {
    description: "Run or control a parent-owned, evidence-gated workflow.",
    handler: async (args, ctx) => {
      if (isSubagent) {
        ctx.ui.notify("Waves orchestration is only available in the main session.", "warning");
        return;
      }
      const command = parseWavesCommand(args);
      if (command.kind === "invalid") {
        ctx.ui.notify(command.reason, "warning");
        return;
      }
      if (command.kind === "status") {
        ctx.ui.notify(formatWavesStatus(workflowModule.inspect()?.snapshot), "info");
        return;
      }
      if (command.kind === "pause") {
        try {
          const paused = workflowRuntime.pause("operator_paused");
          ctx.ui.notify(`Waves paused — ${paused.workflowId}. Run /waves resume to continue.`, "warning");
          if (paused.mode === "goal_attached") await returnContinuationToGoal();
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
        }
        return;
      }
      if (command.kind === "cancel") {
        try {
          const cancelled = workflowRuntime.cancel("operator_cancelled");
          spec.reset();
          ctx.ui.notify(`Waves cancelled — ${cancelled.workflowId}. Working-tree changes were preserved.`, "warning");
          if (cancelled.mode === "goal_attached") await returnContinuationToGoal();
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
        }
        return;
      }
      if (command.kind === "handoff") {
        try {
          const { destination } = workflowRuntime.handoff();
          const parentSession = ctx.sessionManager.getSessionFile();
          let replacement: { cancelled: boolean };
          try {
            replacement = await ctx.newSession({
              ...(parentSession ? { parentSession } : {}),
              setup: async (sessionManager) => {
                sessionManager.appendCustomEntry(WORKFLOW_JOURNAL_ENTRY, destination);
              },
              withSession: async (replacementCtx) => {
                replacementCtx.ui.notify(
                  `Waves handoff received — ${destination.workflowId}. Run /waves resume for fresh approval.`,
                  "info",
                );
              },
            });
          } catch (error) {
            workflowRuntime.restoreFailedHandoff("session_replacement_failed");
            throw error;
          }
          if (replacement.cancelled) {
            workflowRuntime.restoreFailedHandoff("session_replacement_cancelled");
            ctx.ui.notify("Waves handoff cancelled; the source workflow is paused and recoverable.", "warning");
          }
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
        }
        return;
      }
      if (command.kind === "resume") {
        try {
          if (command.maxIntegrationTurns !== undefined || command.maxJuryRounds !== undefined) {
            workflowRuntime.reviseLimits({
              ...(command.maxIntegrationTurns === undefined
                ? {}
                : { maxIntegrationTurns: command.maxIntegrationTurns }),
              ...(command.maxJuryRounds === undefined
                ? {}
                : { maxJuryRounds: command.maxJuryRounds }),
            });
          }
          const resumed = workflowRuntime.resume();
          if (resumed.phase === "planning") {
            await executePlanning(resumed.goal, ctx);
            return;
          }
          if (!await authorizeWorkflowPlan(resumed.plan, ctx, { bindJournalPlan: false })) return;
          const approved = workflowRuntime.current;
          if (approved?.phase === "investigating") {
            const result = await investigateWorkflow(approved.plan, ctx);
            if (result.state !== "completed") {
              ctx.ui.notify(formatWorkflowOutcome(result), "warning");
              return;
            }
            await queueIntegration(approved.plan, result, ctx);
            return;
          }
          if (approved?.phase === "reviewing") {
            const directive =
              "[harness:waves-review] Settle the recorded workflow_yield. Do not mutate the repository; Waves will verify revision freshness at agent_end.";
            issueContinuation(sessionId, "waves", directive);
            await pi.sendUserMessage(directive, { deliverAs: "followUp" });
            ctx.ui.notify("Waves review resumed.", "info");
            return;
          }
          if (approved?.phase === "awaiting_acceptance") {
            const directive = approved.mode === "goal_attached"
              ? "Waves jury approval is recorded. Call goal_complete with the evidence-backed completion reason."
              : "Waves acceptance is pending. Resolve the reported SpecEngine evidence gaps, then call workflow_yield on the new revision.";
            issueContinuation(sessionId, "waves", directive);
            await pi.sendUserMessage(directive, { deliverAs: "followUp" });
            ctx.ui.notify("Waves acceptance resumed.", "info");
            return;
          }
          if (approved?.phase !== "integrating") {
            ctx.ui.notify(`Waves resumed into ${approved?.phase ?? "unknown"}; use /waves status for the pending action.`, "info");
            return;
          }
          const directive = buildResumeDirective(approved);
          issueContinuation(sessionId, "waves", directive);
          await pi.sendUserMessage(directive, { deliverAs: "followUp" });
          ctx.ui.notify("Waves resumed.", "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
        }
        return;
      }

      const goalState = getGoal();
      const attaching = command.kind === "attach_goal";
      if (attaching && (!goalState || goalState.status === "achieved")) {
        ctx.ui.notify("No nonterminal /goal exists to attach. Set one first or use /waves <goal>.", "warning");
        return;
      }
      if (!attaching && goalState && goalState.status !== "achieved") {
        ctx.ui.notify("A nonterminal /goal already exists. Use /waves goal, or finish/clear the goal first.", "warning");
        return;
      }
      const goal = command.kind === "attach_goal"
        ? goalState?.condition
        : command.goal;
      if (!goal) {
        ctx.ui.notify("Waves could not resolve a goal to execute.", "warning");
        return;
      }
      try {
        workflowRuntime.start({ goal, mode: attaching ? "goal_attached" : "standalone" });
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
        return;
      }
      ctx.ui.notify("Running evidence-gated waves workflow…", "info");
      if (!attaching || !spec.activeSpec) spec.startTurn(goal, true);
      await executePlanning(goal, ctx);
    },
  });

  // ── /subagents-models ────────────────────────────────────────────────────
  // Edit the role → model routing that pi-subagents reads from settings.
  pi.registerCommand("subagents-models", {
    description: "Show or update subagent model routing. Subcommands: list, set [role [model]], clear <role>, enable, disable.",
    // `/subagents-models-set` and `/subagents-models-toggle` used to be separate
    // top-level commands that re-implemented this one's argument handling —
    // parseSubagentModelsCommand already routes `set` (with 0, 1 or 2+ args),
    // `enable`, `disable`, `toggle on|off`, `clear <role>` and `list`. They
    // existed for palette discoverability, which completions provide without
    // costing two more entries in a 25-command surface.
    getArgumentCompletions: (prefix) => {
      const subs = [
        { value: "list", label: "list — show current routing" },
        { value: "set", label: "set — pick a role, then a model" },
        { value: "clear", label: "clear <role> — drop a role's override" },
        { value: "enable", label: "enable — turn per-role routing on" },
        { value: "disable", label: "disable — all subagents use /models" },
      ].filter((s) => s.value.startsWith(prefix.trimStart().split(/\s+/)[0] ?? ""));
      return subs.length > 0 ? subs : null;
    },
    handler: async (args, ctx) => {
      try {
        const result = await handleSubagentModelsCommand(args, {
          selectRole: async (roles) => {
            if (typeof ctx.ui.select !== "function") {
              return undefined;
            }
            const selected = await ctx.ui.select("Choose subagent role", roles);
            return typeof selected === "string" ? selected : undefined;
          },
          selectModel: async (role, models) => {
            if (typeof ctx.ui.select !== "function") {
              return undefined;
            }
            const labels = makeTerminalSafeOptions(models);
            const selected = await ctx.ui.select(`Choose model for ${role}`, labels);
            if (typeof selected !== "string") return undefined;
            const index = labels.indexOf(selected);
            return index >= 0 ? models[index] : undefined;
          },
        });
        ctx.ui.notify(result.message, result.level);
      } catch (err) {
        ctx.ui.notify(String(err instanceof Error ? err.message : err), "warning");
      }
    },
  });

  // ── /audit ────────────────────────────────────────────────────────────────
  // The truth about what happened — tool by tool.
  pi.registerCommand("audit", {
    description: "Show the last N audit log entries. Defaults to 10.",
    getArgumentCompletions: (prefix) => {
      const opts = ["5", "10", "20", "50"];
      const filtered = opts.filter(o => o.startsWith(prefix));
      return filtered.length > 0 ? filtered.map(value => ({ value, label: `last ${value}` })) : null;
    },
    handler: async (args, ctx) => {
      const policyState = await policyPromise;
      const theme = ctx.ui.theme;
      if (policyState.kind === "error") {
        ctx.ui.notify(formatPanel(theme, "Policy Error", policyState.error, "error"), "warning");
        return;
      }
      const { policy } = policyState;

      if (!policy.audit.enabled) {
        ctx.ui.notify(
          "Audit logging is off for this policy preset.\nSet audit.enabled = true in harness.policy.json to enable it.",
          "warning",
        );
        return;
      }

      const auditPath = policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl");
      const n = Math.max(1, parseInt(args.trim() || "10", 10) || 10);

      let raw: string;
      try {
        raw = await readFile(auditPath, "utf-8");
      } catch {
        ctx.ui.notify(
          "No audit log yet.\nIt gets written on the first governed tool call.",
          "info",
        );
        return;
      }

      const entries = raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-n)
        .map(line => {
          try { return JSON.parse(line) as AuditEvent; } catch { return null; }
        })
        .filter((e): e is AuditEvent => e !== null);

      if (entries.length === 0) {
        ctx.ui.notify("Audit log is empty.", "info");
        return;
      }

      ctx.ui.notify(renderAuditPanel(theme, entries), "info");
    },
  });

  // ── /rename ───────────────────────────────────────────────────────────────
  // Sessions are easier to find when they're named.
  pi.registerCommand("rename", {
    description: "Rename the current session.",
    handler: async (args, ctx) => {
      const name = args.trim();
      const theme = ctx.ui.theme;
      if (!name) {
        ctx.ui.notify("Pass a name: /rename <session-name>", "warning");
        return;
      }
      await pi.setSessionName(name);
      ctx.ui.notify(formatPanel(theme, "Session", `Renamed to: ${theme.fg("accent", sanitizeTerminalText(name))}`, "dim"), "info");
    },
  });

  // ── /status ───────────────────────────────────────────────────────────────
  // Everything you need to know about this session in one shot.
  pi.registerCommand("status", {
    description: "Show a full session snapshot: model, thinking, mode, spec, context, and policy.",
    handler: async (_args, ctx) => {
      const policyState = await policyPromise;
      const theme = ctx.ui.theme;
      if (policyState.kind === "error") {
        ctx.ui.notify(formatPanel(theme, "Policy Error", policyState.error, "error"), "warning");
        return;
      }
      const { policy } = policyState;
      const model = ctx.model;
      const thinking = pi.getThinkingLevel() as ThinkingLevel | undefined;
      const usage = ctx.getContextUsage();
      const active = spec.activeSpec;

      const modelStr = model ? (model.name || model.id) : "none";
      const thinkingStr = thinking && thinking !== "off" ? thinking : "off";

      let contextStr = theme.fg("dim", "unknown");
      if (usage) {
        const pct = usage.percent !== null ? `${Math.round(usage.percent * 100)}%` : "?%";
        const tok = usage.tokens !== null ? fmtN(usage.tokens) : "?";
        const wk = Math.round(usage.contextWindow / 1000);
        contextStr = `${formatValue(theme, tok, "accent")} tokens  ${theme.fg("dim", "(")}${usage.percent && usage.percent > 0.8 ? theme.fg("warning", pct) : theme.fg("success", pct)} of ${wk}k${theme.fg("dim", ")")}`;
      }

      const panel = renderSessionSnapshotPanel(theme, {
        modelStr,
        thinkingStr,
        spec: active,
        contextStr,
        policy,
        yolo: permissions.isYolo,
      });
      ctx.ui.notify(panel, "info");
    },
  });

}
