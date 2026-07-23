import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { GoalController } from "../goal/controller";
import type { GoalSettings } from "../goal/types";
import { extractLastTurnFromBranch } from "../goal/extract";
import { runEvaluatorWith } from "../goal/evaluator";
import { confirmGoalCompletion } from "../goal/confirm";
import { loadEvaluatorOverride } from "../goal/load-settings";
import { pickEvaluatorModel, resolveEvaluatorAuth } from "../goal/evaluator-model";
import { renderGoalStatusSegment } from "../goal/command";
import type { GoalEventRecord } from "../goal/loop";
import type { PolicyLoadState } from "../policy/state";
import { AskParamsSchema, buildAskDecision, resolveHeadlessAsk, type AskQuestion } from "../interaction/ask";
import { FindingParamsSchema, addFinding, formatReviewSummary, type ReviewFinding } from "../review/findings";

export interface GoalCompleteToolDeps {
  goalController: GoalController;
  goalSettings: GoalSettings;
  recordGoalEvent: (event: GoalEventRecord) => Promise<void>;
}

/**
 * goal_complete tool: agent-signaled completion, evaluator-confirmed. The
 * agent calls this when it believes the active /goal is done. A fresh,
 * tool-less checker (the same evaluator, routed via the subagents toggle,
 * else the session model) confirms against the last turn's evidence before
 * the goal closes. On MET the loop terminates; on NOT_MET the agent keeps
 * working. Crucially, a checker ERROR never pauses the goal — it fails safe
 * to NOT_MET — so the per-turn "eval-error pause" class is gone entirely.
 * Parent sessions only.
 */
export function registerGoalCompleteTool(pi: ExtensionAPI, deps: GoalCompleteToolDeps): void {
  const { goalController, goalSettings, recordGoalEvent } = deps;

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

/**
 * ask tool: ask the user one option-based question and return a governed
 * decision record. Parent sessions only.
 */
export function registerAskTool(pi: ExtensionAPI, policyStatePromise: Promise<PolicyLoadState>): void {
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

export interface ReportFindingToolDeps {
  getReviewFindings: () => ReviewFinding[];
  setReviewFindings: (findings: ReviewFinding[]) => void;
}

/**
 * report_finding tool: record a structured review finding and return the
 * aggregate review verdict. Registered for every subagent process, not just
 * reviewer roles: several live roster agents (reviewer, reviewer-correctness,
 * reviewer-security, reviewer-tests, evaluator) list report_finding in their
 * frontmatter tool set, and per-agent exposure is already governed by that
 * list (pi-subagents filters registered tools down to it) — narrowing the
 * registration itself to one legacy-only role left every live one calling a
 * tool that was never registered in their process. Subagent sessions only.
 */
export function registerReportFindingTool(pi: ExtensionAPI, deps: ReportFindingToolDeps): void {
  pi.registerTool({
    name: "report_finding",
    label: "Report review finding",
    description: "Record a structured review finding and return the aggregate review verdict.",
    parameters: FindingParamsSchema,
    async execute(_toolCallId, params, _signal, _onUpdate) {
      try {
        const updated = addFinding(deps.getReviewFindings(), params);
        deps.setReviewFindings(updated);
        return { content: [{ type: "text" as const, text: formatReviewSummary(updated) }], details: undefined };
      } catch (err) {
        return { content: [{ type: "text" as const, text: String(err) }], isError: true, details: undefined };
      }
    },
  });
}
