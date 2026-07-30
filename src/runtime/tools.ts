import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { GoalController } from "../goal/controller";
import { renderGoalStatusSegment } from "../goal/command";
import type { PolicyLoadState } from "../policy/state";
import { AskParamsSchema, buildAskDecision, resolveHeadlessAsk, type AskQuestion } from "../interaction/ask";
import { FindingParamsSchema, addFinding, formatReviewSummary, type ReviewFinding } from "../review/findings";

export interface GoalCompleteToolDeps {
  goalController: GoalController;
}

/**
 * goal_complete records an untrusted Completion Claim. SpecEngine decides it
 * at agent_end after repository and workflow evidence has settled.
 */
export function registerGoalCompleteTool(pi: ExtensionAPI, deps: GoalCompleteToolDeps): void {
  const { goalController } = deps;

  pi.registerTool({
    name: "goal_complete",
    label: "Goal Complete",
    description:
      "Claim that the active /goal is complete. SpecEngine verifies repository and workflow evidence at agent_end; this tool cannot close the goal.",
    promptSnippet: "Claim goal completion once every requirement is finished and verified",
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

      goalController.claimComplete(params.summary);
      toolCtx.ui.setStatus("harness-goal", renderGoalStatusSegment(goalController.snapshot()));
      return {
        content: [{
          type: "text" as const,
          text: "Completion claim recorded. SpecEngine will decide it at agent_end from deterministic repository and workflow evidence.",
        }],
        details: undefined,
      };
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
