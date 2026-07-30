import type { VerificationResult } from "../spec/verification";
import { buildContinuationPrompt, gatedFailures } from "../spec/gate";
import { juryVerdictFromResult, workflowEvidenceRefs } from "./runtime";
import { sameRepositoryRevision } from "./revision";
import type { WorkflowRunResult } from "./types";
import type {
  RepositoryRevisionIdentity,
  WorkflowEvidenceRef,
  WorkflowRuntime,
} from "./state";

export interface WorkflowAgentEndDependencies {
  runtime: WorkflowRuntime;
  cwd: string;
  sendContinuation: (directive: string) => Promise<void>;
  runJury: () => Promise<WorkflowRunResult>;
  captureRevision: (cwd: string) => Promise<RepositoryRevisionIdentity | undefined>;
  recordWorkflowEvidence: (
    evidence: WorkflowEvidenceRef[],
    options: { accepted: boolean; reasons: string[] },
  ) => void;
  verify: () => VerificationResult[];
}

export type WorkflowAgentEndResult =
  | { owned: false; state: "inactive" }
  | { owned: true; state: "continued" | "paused" | "retrying" | "completed" }
  | { owned: true; state: "awaiting_goal_claim"; directive: string };

function integrationDirective(runtime: WorkflowRuntime): string {
  const current = runtime.current;
  if (!current || current.phase !== "integrating") {
    throw new Error("Waves workflow is not integrating");
  }
  const { integrationTurns, plan } = current;
  return [
    `Continue as the Waves Integration Owner (${integrationTurns}/${plan.integration.limits.maxIntegrationTurns} integration turns used).`,
    `Goal: ${current.goal}`,
    `Work only within: ${plan.integration.targetRoots.join(", ")}`,
    "When the integration contract is satisfied, call workflow_yield.",
  ].join("\n");
}

function correctionDirective(
  runtime: WorkflowRuntime,
  blockers: Array<{ evidence: string; path: string; requiredCorrection: string }>,
): string {
  return [
    integrationDirective(runtime),
    "",
    "The structured jury requested these blocking corrections:",
    ...blockers.map((blocker, index) =>
      `${index + 1}. ${blocker.path}: ${blocker.requiredCorrection}\n   Evidence: ${blocker.evidence}`),
    "After correcting every blocker and re-running the relevant checks, call workflow_yield for the new revision.",
  ].join("\n");
}

function mergeEvidence(
  previous: WorkflowEvidenceRef[],
  next: WorkflowEvidenceRef[],
): WorkflowEvidenceRef[] {
  const merged = new Map(previous.map((reference) => [
    `${reference.ownerRunId}:${reference.nodeId}:${reference.runId}`,
    reference,
  ]));
  for (const reference of next) {
    merged.set(`${reference.ownerRunId}:${reference.nodeId}:${reference.runId}`, reference);
  }
  return [...merged.values()];
}

export async function handleWorkflowAgentEnd(
  dependencies: WorkflowAgentEndDependencies,
  event: {
    aborted: boolean;
    willRetry: boolean;
    terminalFailure?: boolean;
    goalClaimed?: boolean;
  },
): Promise<WorkflowAgentEndResult> {
  const current = dependencies.runtime.current;
  if (!current || current.phase === "completed" || current.phase === "cancelled" || current.phase === "handed_off") {
    return { owned: false, state: "inactive" };
  }
  if (event.willRetry) return { owned: true, state: "retrying" };
  if (event.aborted) {
    if (current.phase !== "paused") dependencies.runtime.pause("user_abort");
    return { owned: true, state: "paused" };
  }
  if (event.terminalFailure) {
    if (current.phase !== "paused") dependencies.runtime.pause("parent_turn_failed");
    return { owned: true, state: "paused" };
  }
  if (current.phase !== "integrating") {
    if (current.phase === "awaiting_acceptance" && current.mode === "goal_attached") {
      const actualRevision = await dependencies.captureRevision(dependencies.cwd);
      if (!actualRevision || !sameRepositoryRevision(current.yieldIdentity, actualRevision)) {
        dependencies.runtime.pause(actualRevision ? "yield_revision_stale" : "repository_revision_unavailable");
        return { owned: true, state: "paused" };
      }
      if (!event.goalClaimed) {
        const next = dependencies.runtime.recordAcceptanceTurn();
        if (next.phase === "paused") return { owned: true, state: "paused" };
      }
      return {
        owned: true,
        state: "awaiting_goal_claim",
        directive:
          "Waves jury and SpecEngine verification passed. Call goal_complete with the evidence-backed completion reason.",
      };
    }
    if (current.phase !== "reviewing") {
      return { owned: true, state: current.phase === "paused" ? "paused" : "continued" };
    }

    const reviewing = dependencies.runtime.recordReviewTurn();
    const actualRevision = await dependencies.captureRevision(dependencies.cwd);
    if (!actualRevision || !sameRepositoryRevision(reviewing.yieldIdentity, actualRevision)) {
      dependencies.runtime.pause(actualRevision ? "yield_revision_stale" : "repository_revision_unavailable");
      return { owned: true, state: "paused" };
    }

    const juryResult = await dependencies.runJury();
    const verdict = juryVerdictFromResult(juryResult);
    const juryEvidence = workflowEvidenceRefs(juryResult);
    if (!verdict || juryResult.state !== "completed") {
      dependencies.recordWorkflowEvidence(juryEvidence, {
        accepted: false,
        reasons: juryResult.reasons.length > 0 ? juryResult.reasons : ["structured jury verdict is unavailable"],
      });
      dependencies.runtime.pause("jury_evidence_incomplete");
      return { owned: true, state: "paused" };
    }

    if (verdict.verdict === "REQUEST_CHANGES") {
      dependencies.recordWorkflowEvidence(juryEvidence, {
        accepted: false,
        reasons: verdict.blockers.map((blocker) => `${blocker.path}: ${blocker.requiredCorrection}`),
      });
      const correction = verdict.blockers.map((blocker, index) =>
        `${index + 1}. ${blocker.path}: ${blocker.requiredCorrection}\n   Evidence: ${blocker.evidence}`)
        .join("\n");
      const next = dependencies.runtime.requestChanges(correction);
      if (next.phase === "paused") return { owned: true, state: "paused" };
      await dependencies.sendContinuation(correctionDirective(dependencies.runtime, verdict.blockers));
      return { owned: true, state: "continued" };
    }

    const acceptedEvidence = mergeEvidence(reviewing.acceptedEvidence, juryEvidence);
    dependencies.runtime.approveReview(juryEvidence);
    dependencies.recordWorkflowEvidence(acceptedEvidence, {
      accepted: true,
      reasons: verdict.warnings,
    });
    const verification = dependencies.verify();
    const blocking = gatedFailures(verification);
    if (blocking.length > 0) {
      const next = dependencies.runtime.reopenIntegration("integration_turn_budget_exhausted");
      if (next.phase === "paused") return { owned: true, state: "paused" };
      await dependencies.sendContinuation(buildContinuationPrompt(verification, next.integrationTurns));
      return { owned: true, state: "continued" };
    }
    if (reviewing.mode === "goal_attached") {
      return {
        owned: true,
        state: "awaiting_goal_claim",
        directive:
          "Waves jury and SpecEngine verification passed. Call goal_complete with the evidence-backed completion reason.",
      };
    }
    dependencies.runtime.complete("SpecEngine accepted the Waves Work Contract");
    return { owned: true, state: "completed" };
  }

  const next = dependencies.runtime.recordIntegrationTurn();
  if (next.phase === "paused") return { owned: true, state: "paused" };
  await dependencies.sendContinuation(integrationDirective(dependencies.runtime));
  return { owned: true, state: "continued" };
}
