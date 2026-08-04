import type { RunFact } from "../execution/types";
import type { RunProjection } from "../execution/projection";
import { buildCurrentRunProjection } from "../execution/projection";
import type { GoalSnapshot } from "../goal/types";
import type { WorkflowSnapshot } from "../workflows/state";

export function formatRunProjection(projection: RunProjection | undefined): string {
  if (!projection) return "Run — no recorded execution facts on the active session branch.";
  const lines = [
    `Run ${projection.runId} — ${projection.state}`,
    ...(projection.workflow
      ? [`  Waves: ${projection.workflow.phase} — ${projection.workflow.goal}${projection.workflow.reason ? ` (${projection.workflow.reason})` : ""}`]
      : []),
    ...(projection.goal
      ? [`  Goal: ${projection.goal.status} — ${projection.goal.condition} · ${projection.goal.turns} turns`]
      : []),
    ...(projection.delegations.length > 0
      ? ["  Delegations:", ...projection.delegations.map((entry) =>
          `    ${entry.nodeId} attempt ${entry.attempt}: ${entry.state}${entry.reason ? ` — ${entry.reason}` : ""}`)]
      : []),
    ...(projection.recovery.length > 0
      ? ["  Recovery:", ...projection.recovery.map((entry) =>
          `    ${entry.state}${entry.state === "failed" ? ` — ${entry.reason}` : entry.state === "skipped" ? ` — ${entry.reason}` : ` — ${entry.reference}`}`)]
      : []),
    ...(projection.acceptance ? [`  Acceptance: ${projection.acceptance.verdict}${projection.acceptance.reasons.length > 0 ? ` — ${projection.acceptance.reasons.join("; ")}` : ""}`] : []),
    ...(projection.warnings.length > 0 ? ["  Warnings:", ...projection.warnings.map((warning) => `    ${warning}`)] : []),
  ];
  return lines.join("\n");
}

export function currentRunProjection(input: {
  facts: readonly RunFact[];
  goal?: GoalSnapshot;
  workflow?: WorkflowSnapshot;
}): RunProjection | undefined {
  return buildCurrentRunProjection(input);
}
