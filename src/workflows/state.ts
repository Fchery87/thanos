import { randomUUID } from "node:crypto";
import { parseWavePlan } from "./runtime";
import type { WavePlan } from "./types";

export const WORKFLOW_JOURNAL_ENTRY = "thanos-waves-workflow";

export type WorkflowMode = "standalone" | "goal_attached";

export interface WorkflowEvidenceRef {
  nodeId: string;
  requestId: string;
  ownerRunId: string;
  runId: string;
  launchContractDigest: string;
  artifacts: Array<{ path: string; sha256: string }>;
}

export interface RepositoryRevisionIdentity {
  head: string;
  workingTree: Array<[path: string, identity: string]>;
}

interface WorkflowIdentity {
  workflowId: string;
  goal: string;
  mode: WorkflowMode;
  createdAt: number;
  lineageParentId?: string;
}

interface WorkflowProgress extends WorkflowIdentity {
  plan: WavePlan;
  acceptedEvidence: WorkflowEvidenceRef[];
  nodeAttempts: Record<string, number>;
  integrationTurns: number;
  juryRounds: number;
}

export interface PlanningWorkflow extends WorkflowIdentity {
  phase: "planning";
}

export interface AwaitingApprovalWorkflow extends WorkflowProgress {
  phase: "awaiting_approval";
}

export interface InvestigatingWorkflow extends WorkflowProgress {
  phase: "investigating";
}

export interface IntegratingWorkflow extends WorkflowProgress {
  phase: "integrating";
  correction: string | null;
}

export interface ReviewingWorkflow extends WorkflowProgress {
  phase: "reviewing";
  yieldIdentity: RepositoryRevisionIdentity;
}

export interface AwaitingAcceptanceWorkflow extends WorkflowProgress {
  phase: "awaiting_acceptance";
  yieldIdentity: RepositoryRevisionIdentity;
}

export type ActiveWorkflow =
  | PlanningWorkflow
  | AwaitingApprovalWorkflow
  | InvestigatingWorkflow
  | IntegratingWorkflow
  | ReviewingWorkflow
  | AwaitingAcceptanceWorkflow;

export interface PausedWorkflow extends WorkflowIdentity {
  phase: "paused";
  reason: string;
  resume: ActiveWorkflow;
}

export interface CompletedWorkflow extends WorkflowIdentity {
  phase: "completed";
  previous: ActiveWorkflow;
  reason: string;
}

export interface CancelledWorkflow extends WorkflowIdentity {
  phase: "cancelled";
  previous: ActiveWorkflow | PausedWorkflow;
  reason: string;
}

export interface HandedOffWorkflow extends WorkflowIdentity {
  phase: "handed_off";
  previous: ActiveWorkflow | PausedWorkflow;
  reason: string;
  destinationWorkflowId: string;
}

export type WorkflowSnapshot =
  | ActiveWorkflow
  | PausedWorkflow
  | CompletedWorkflow
  | CancelledWorkflow
  | HandedOffWorkflow;

export interface WorkflowRuntimeOptions {
  append?: (snapshot: WorkflowSnapshot) => void;
  createId?: () => string;
  now?: () => number;
  recordLifecycle?: (event: {
    workflowId: string;
    from?: WorkflowSnapshot["phase"];
    to: WorkflowSnapshot["phase"];
    reason?: string;
  }) => void;
}

interface SessionEntryLike {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseIdentity(value: Record<string, unknown>): WorkflowIdentity | undefined {
  const lineageParentId = value.lineageParentId;
  if (
    !nonEmpty(value.workflowId)
    || !nonEmpty(value.goal)
    || (value.mode !== "standalone" && value.mode !== "goal_attached")
    || typeof value.createdAt !== "number"
    || !Number.isFinite(value.createdAt)
    || (lineageParentId !== undefined && !nonEmpty(lineageParentId))
  ) return undefined;
  const lineage = typeof lineageParentId === "string" ? lineageParentId : undefined;
  return {
    workflowId: value.workflowId,
    goal: value.goal,
    mode: value.mode,
    createdAt: value.createdAt,
    ...(lineage === undefined ? {} : { lineageParentId: lineage }),
  };
}

function parseEvidenceRef(value: unknown): WorkflowEvidenceRef | undefined {
  const raw = record(value);
  if (
    !raw
    || !nonEmpty(raw.nodeId)
    || !nonEmpty(raw.requestId)
    || !nonEmpty(raw.ownerRunId)
    || !nonEmpty(raw.runId)
    || !nonEmpty(raw.launchContractDigest)
    || !Array.isArray(raw.artifacts)
  ) return undefined;
  const artifacts: Array<{ path: string; sha256: string }> = [];
  for (const value of raw.artifacts) {
    const artifact = record(value);
    if (!artifact || !nonEmpty(artifact.path) || !nonEmpty(artifact.sha256)) return undefined;
    artifacts.push({ path: artifact.path, sha256: artifact.sha256 });
  }
  return {
    nodeId: raw.nodeId,
    requestId: raw.requestId,
    ownerRunId: raw.ownerRunId,
    runId: raw.runId,
    launchContractDigest: raw.launchContractDigest,
    artifacts,
  };
}

function parseProgress(value: Record<string, unknown>): WorkflowProgress | undefined {
  const identity = parseIdentity(value);
  const plan = parseWavePlan(value.plan);
  if (
    !identity
    || !plan
    || !Array.isArray(value.acceptedEvidence)
    || !record(value.nodeAttempts)
    || !Number.isInteger(value.integrationTurns)
    || Number(value.integrationTurns) < 0
    || !Number.isInteger(value.juryRounds)
    || Number(value.juryRounds) < 0
  ) return undefined;
  const acceptedEvidence = value.acceptedEvidence.map(parseEvidenceRef);
  if (acceptedEvidence.some((entry) => entry === undefined)) return undefined;
  const nodeAttempts: Record<string, number> = {};
  for (const [nodeId, attempts] of Object.entries(record(value.nodeAttempts) ?? {})) {
    if (!Number.isInteger(attempts) || Number(attempts) < 0) return undefined;
    nodeAttempts[nodeId] = Number(attempts);
  }
  return {
    ...identity,
    plan,
    acceptedEvidence: acceptedEvidence.filter((entry): entry is WorkflowEvidenceRef => entry !== undefined),
    nodeAttempts,
    integrationTurns: Number(value.integrationTurns),
    juryRounds: Number(value.juryRounds),
  };
}

function parseRevisionIdentity(value: unknown): RepositoryRevisionIdentity | undefined {
  const raw = record(value);
  if (!raw || !nonEmpty(raw.head) || !Array.isArray(raw.workingTree)) return undefined;
  const workingTree: Array<[string, string]> = [];
  for (const item of raw.workingTree) {
    if (!Array.isArray(item) || item.length !== 2 || !nonEmpty(item[0]) || typeof item[1] !== "string") {
      return undefined;
    }
    workingTree.push([item[0], item[1]]);
  }
  return { head: raw.head, workingTree };
}

function parseActive(value: unknown): ActiveWorkflow | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const identity = parseIdentity(raw);
  if (!identity) return undefined;
  if (raw.phase === "planning") return { ...identity, phase: "planning" };
  const progress = parseProgress(raw);
  if (!progress) return undefined;
  if (raw.phase === "awaiting_approval") return { ...progress, phase: "awaiting_approval" };
  if (raw.phase === "investigating") return { ...progress, phase: "investigating" };
  if (raw.phase === "integrating") {
    if (raw.correction !== undefined && raw.correction !== null && typeof raw.correction !== "string") {
      return undefined;
    }
    return {
      ...progress,
      phase: "integrating",
      correction: typeof raw.correction === "string" ? raw.correction : null,
    };
  }
  if (raw.phase === "reviewing") {
    const yieldIdentity = parseRevisionIdentity(raw.yieldIdentity);
    return yieldIdentity ? { ...progress, phase: "reviewing", yieldIdentity } : undefined;
  }
  if (raw.phase === "awaiting_acceptance") {
    const yieldIdentity = parseRevisionIdentity(raw.yieldIdentity);
    return yieldIdentity ? { ...progress, phase: "awaiting_acceptance", yieldIdentity } : undefined;
  }
  return undefined;
}

function parseSnapshot(value: unknown): WorkflowSnapshot | undefined {
  const active = parseActive(value);
  if (active) return active;
  const raw = record(value);
  if (!raw) return undefined;
  const identity = parseIdentity(raw);
  if (!identity || !nonEmpty(raw.reason)) return undefined;
  if (raw.phase === "paused") {
    const resume = parseActive(raw.resume);
    return resume ? { ...identity, phase: "paused", reason: raw.reason, resume } : undefined;
  }
  if (raw.phase === "completed") {
    const previous = parseActive(raw.previous);
    return previous ? { ...identity, phase: "completed", reason: raw.reason, previous } : undefined;
  }
  const previous = parseActive(raw.previous) ?? parseSnapshot(raw.previous);
  if (!previous || (previous.phase !== "paused" && !isActive(previous))) return undefined;
  if (raw.phase === "cancelled") {
    return { ...identity, phase: "cancelled", reason: raw.reason, previous };
  }
  if (raw.phase === "handed_off" && nonEmpty(raw.destinationWorkflowId)) {
    return {
      ...identity,
      phase: "handed_off",
      reason: raw.reason,
      destinationWorkflowId: raw.destinationWorkflowId,
      previous,
    };
  }
  return undefined;
}

function isActive(snapshot: WorkflowSnapshot): snapshot is ActiveWorkflow {
  return [
    "planning",
    "awaiting_approval",
    "investigating",
    "integrating",
    "reviewing",
    "awaiting_acceptance",
  ].includes(snapshot.phase);
}

function progressFor(plan: WavePlan, identity: WorkflowIdentity): WorkflowProgress {
  return {
    ...identity,
    plan,
    acceptedEvidence: [],
    nodeAttempts: {},
    integrationTurns: 0,
    juryRounds: 0,
  };
}

function reidentifyActive(
  active: ActiveWorkflow,
  identity: WorkflowIdentity,
): ActiveWorkflow {
  switch (active.phase) {
    case "planning":
      return { ...active, ...identity };
    case "awaiting_approval":
      return { ...active, ...identity };
    case "investigating":
      return { ...active, ...identity };
    case "integrating":
      return { ...active, ...identity };
    case "reviewing":
      return { ...active, ...identity };
    case "awaiting_acceptance":
      return { ...active, ...identity };
  }
}

function mergeEvidenceRefs(
  current: WorkflowEvidenceRef[],
  next: WorkflowEvidenceRef[],
): WorkflowEvidenceRef[] {
  const references = new Map(current.map((reference) => [reference.requestId, reference]));
  for (const reference of next) references.set(reference.requestId, reference);
  return [...references.values()];
}

export class WorkflowRuntime {
  private snapshot: WorkflowSnapshot | undefined;
  private readonly append: (snapshot: WorkflowSnapshot) => void;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly recordLifecycle: NonNullable<WorkflowRuntimeOptions["recordLifecycle"]>;

  constructor(options: WorkflowRuntimeOptions = {}) {
    this.append = options.append ?? (() => {});
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.recordLifecycle = options.recordLifecycle ?? (() => {});
  }

  get current(): WorkflowSnapshot | undefined {
    return this.snapshot;
  }

  reconstruct(
    branch: readonly SessionEntryLike[],
    options: { pauseActiveReason?: string } = {},
  ): WorkflowSnapshot | undefined {
    let latest: WorkflowSnapshot | undefined;
    for (const entry of branch) {
      if (entry.type !== "custom" || entry.customType !== WORKFLOW_JOURNAL_ENTRY) continue;
      const parsed = parseSnapshot(entry.data);
      if (parsed) latest = parsed;
    }
    this.snapshot = latest;
    if (latest && isActive(latest) && options.pauseActiveReason) {
      return this.commit({
        ...latest,
        phase: "paused",
        reason: options.pauseActiveReason,
        resume: latest,
      });
    }
    return latest;
  }

  start(input: { goal: string; mode: WorkflowMode; lineageParentId?: string }): PlanningWorkflow {
    if (this.snapshot && this.snapshot.phase !== "completed" && this.snapshot.phase !== "cancelled" && this.snapshot.phase !== "handed_off") {
      throw new Error("A nonterminal Waves workflow already exists");
    }
    const next: PlanningWorkflow = {
      phase: "planning",
      workflowId: this.createId(),
      goal: input.goal.trim(),
      mode: input.mode,
      createdAt: this.now(),
      ...(input.lineageParentId ? { lineageParentId: input.lineageParentId } : {}),
    };
    return this.commit(next);
  }

  bindPlan(plan: WavePlan): AwaitingApprovalWorkflow {
    const current = this.requirePhase("planning");
    return this.commit({ ...progressFor(plan, current), phase: "awaiting_approval" });
  }

  approve(): InvestigatingWorkflow {
    const current = this.requirePhase("awaiting_approval");
    return this.commit({ ...current, phase: "investigating" });
  }

  recordInvestigationProgress(
    acceptedEvidence: WorkflowEvidenceRef[],
    attemptedNodeIds: string[],
  ): InvestigatingWorkflow {
    const current = this.requirePhase("investigating");
    const nodeAttempts = { ...current.nodeAttempts };
    for (const nodeId of attemptedNodeIds) {
      nodeAttempts[nodeId] = (nodeAttempts[nodeId] ?? 0) + 1;
    }
    return this.commit({
      ...current,
      acceptedEvidence: mergeEvidenceRefs(current.acceptedEvidence, acceptedEvidence),
      nodeAttempts,
    });
  }

  completeInvestigation(acceptedEvidence: WorkflowEvidenceRef[]): IntegratingWorkflow {
    const current = this.requirePhase("investigating");
    return this.commit({
      ...current,
      phase: "integrating",
      acceptedEvidence: mergeEvidenceRefs(current.acceptedEvidence, acceptedEvidence),
      correction: null,
    });
  }

  recordIntegrationTurn(): IntegratingWorkflow | PausedWorkflow {
    const current = this.requirePhase("integrating");
    const next: IntegratingWorkflow = {
      ...current,
      integrationTurns: current.integrationTurns + 1,
    };
    if (next.integrationTurns >= next.plan.integration.limits.maxIntegrationTurns) {
      return this.commit({
        ...next,
        phase: "paused",
        reason: "integration_turn_budget_exhausted",
        resume: next,
      });
    }
    return this.commit(next);
  }

  recordReviewTurn(): ReviewingWorkflow {
    const current = this.requirePhase("reviewing");
    return this.commit({
      ...current,
      integrationTurns: current.integrationTurns + 1,
    });
  }

  yieldForReview(yieldIdentity: RepositoryRevisionIdentity): ReviewingWorkflow | PausedWorkflow {
    const current = this.requirePhase("integrating");
    if (current.juryRounds >= current.plan.integration.limits.maxJuryRounds) {
      return this.commit({
        ...current,
        phase: "paused",
        reason: "jury_round_budget_exhausted",
        resume: current,
      });
    }
    return this.commit({
      ...current,
      phase: "reviewing",
      juryRounds: current.juryRounds + 1,
      yieldIdentity,
    });
  }

  requestChanges(reason: string): IntegratingWorkflow | PausedWorkflow {
    const current = this.requirePhase("reviewing");
    const integration: IntegratingWorkflow = {
      phase: "integrating",
      workflowId: current.workflowId,
      goal: current.goal,
      mode: current.mode,
      createdAt: current.createdAt,
      ...(current.lineageParentId ? { lineageParentId: current.lineageParentId } : {}),
      plan: current.plan,
      acceptedEvidence: [...current.acceptedEvidence],
      nodeAttempts: { ...current.nodeAttempts },
      integrationTurns: current.integrationTurns,
      juryRounds: current.juryRounds,
      correction: reason,
    };
    if (integration.integrationTurns >= integration.plan.integration.limits.maxIntegrationTurns) {
      return this.commit({
        ...integration,
        phase: "paused",
        reason: "integration_turn_budget_exhausted",
        resume: integration,
      });
    }
    if (integration.juryRounds >= integration.plan.integration.limits.maxJuryRounds) {
      return this.commit({
        ...integration,
        phase: "paused",
        reason: "jury_round_budget_exhausted",
        resume: integration,
      });
    }
    return this.commit(integration);
  }

  reopenIntegration(reason: string): IntegratingWorkflow | PausedWorkflow {
    const current = this.requirePhase("awaiting_acceptance");
    const integration: IntegratingWorkflow = {
      phase: "integrating",
      workflowId: current.workflowId,
      goal: current.goal,
      mode: current.mode,
      createdAt: current.createdAt,
      ...(current.lineageParentId ? { lineageParentId: current.lineageParentId } : {}),
      plan: current.plan,
      acceptedEvidence: [...current.acceptedEvidence],
      nodeAttempts: { ...current.nodeAttempts },
      integrationTurns: current.integrationTurns,
      juryRounds: current.juryRounds,
      correction: null,
    };
    if (integration.integrationTurns >= integration.plan.integration.limits.maxIntegrationTurns) {
      return this.commit({
        ...integration,
        phase: "paused",
        reason,
        resume: integration,
      });
    }
    return this.commit(integration);
  }

  approveReview(evidence: WorkflowEvidenceRef[]): AwaitingAcceptanceWorkflow {
    const current = this.requirePhase("reviewing");
    return this.commit({
      ...current,
      phase: "awaiting_acceptance",
      acceptedEvidence: [...current.acceptedEvidence, ...evidence],
    });
  }

  recordAcceptanceTurn(): AwaitingAcceptanceWorkflow | PausedWorkflow {
    const current = this.requirePhase("awaiting_acceptance");
    const next: AwaitingAcceptanceWorkflow = {
      ...current,
      integrationTurns: current.integrationTurns + 1,
    };
    if (next.integrationTurns >= next.plan.integration.limits.maxIntegrationTurns) {
      return this.commit({
        ...next,
        phase: "paused",
        reason: "integration_turn_budget_exhausted",
        resume: next,
      });
    }
    return this.commit(next);
  }

  complete(reason: string): CompletedWorkflow {
    const current = this.requirePhase("awaiting_acceptance");
    return this.commit({
      phase: "completed",
      workflowId: current.workflowId,
      goal: current.goal,
      mode: current.mode,
      createdAt: current.createdAt,
      ...(current.lineageParentId ? { lineageParentId: current.lineageParentId } : {}),
      previous: current,
      reason,
    });
  }

  pause(reason: string): PausedWorkflow {
    if (!this.snapshot || !isActive(this.snapshot)) throw new Error("No active Waves workflow to pause");
    return this.commit({ ...this.snapshot, phase: "paused", reason, resume: this.snapshot });
  }

  resume(): ActiveWorkflow {
    const current = this.requirePhase("paused");
    return this.commit(current.resume);
  }

  reviseLimits(input: {
    maxIntegrationTurns?: number;
    maxJuryRounds?: number;
  }): PausedWorkflow {
    const current = this.requirePhase("paused");
    const active = current.resume;
    if (!("plan" in active)) throw new Error("Waves has no approved plan whose budgets can be revised");
    const oldLimits = active.plan.integration.limits;
    const revisesIntegration = input.maxIntegrationTurns !== undefined;
    const revisesJury = input.maxJuryRounds !== undefined;
    const integrationAllowed = current.reason === "integration_turn_budget_exhausted"
      && input.maxIntegrationTurns !== undefined
      && input.maxIntegrationTurns > oldLimits.maxIntegrationTurns;
    const juryAllowed = current.reason === "jury_round_budget_exhausted"
      && input.maxJuryRounds !== undefined
      && input.maxJuryRounds > oldLimits.maxJuryRounds;
    if (
      (!integrationAllowed && !juryAllowed)
      || (revisesIntegration && !integrationAllowed)
      || (revisesJury && !juryAllowed)
    ) {
      throw new Error("Only exhausted budgets may be revised, and the new total must be greater than the prior total");
    }
    const revisedPlan: WavePlan = {
      ...active.plan,
      integration: {
        ...active.plan.integration,
        limits: {
          maxIntegrationTurns: input.maxIntegrationTurns ?? oldLimits.maxIntegrationTurns,
          maxJuryRounds: input.maxJuryRounds ?? oldLimits.maxJuryRounds,
        },
      },
    };
    const resume: ActiveWorkflow = {
      ...active,
      plan: revisedPlan,
    };
    return this.commit({
      phase: "paused",
      workflowId: current.workflowId,
      goal: current.goal,
      mode: current.mode,
      createdAt: current.createdAt,
      ...(current.lineageParentId ? { lineageParentId: current.lineageParentId } : {}),
      reason: "contract_revision_requires_approval",
      resume,
    });
  }

  cancel(reason: string): CancelledWorkflow {
    const current = this.snapshot;
    if (!current || (!isActive(current) && current.phase !== "paused")) {
      throw new Error("No nonterminal Waves workflow to cancel");
    }
    return this.commit({
      phase: "cancelled",
      workflowId: current.workflowId,
      goal: current.goal,
      mode: current.mode,
      createdAt: current.createdAt,
      ...(current.lineageParentId ? { lineageParentId: current.lineageParentId } : {}),
      previous: current,
      reason,
    });
  }

  handoff(destinationWorkflowId: string = this.createId()): {
    source: HandedOffWorkflow;
    destination: PausedWorkflow;
  } {
    const current = this.snapshot;
    if (!current || (!isActive(current) && current.phase !== "paused")) {
      throw new Error("No nonterminal Waves workflow to hand off");
    }
    const active = current.phase === "paused" ? current.resume : current;
    const destinationIdentity: WorkflowIdentity = {
      workflowId: destinationWorkflowId,
      goal: current.goal,
      mode: current.mode,
      createdAt: this.now(),
      lineageParentId: current.workflowId,
    };
    const destinationResume = reidentifyActive(active, destinationIdentity);
    const destination: PausedWorkflow = {
      ...destinationIdentity,
      phase: "paused",
      reason: "handoff_requires_approval",
      resume: destinationResume,
    };
    const source = this.commit<HandedOffWorkflow>({
      phase: "handed_off",
      workflowId: current.workflowId,
      goal: current.goal,
      mode: current.mode,
      createdAt: current.createdAt,
      ...(current.lineageParentId ? { lineageParentId: current.lineageParentId } : {}),
      previous: current,
      reason: "workflow_handed_off",
      destinationWorkflowId,
    });
    return { source, destination };
  }

  restoreFailedHandoff(reason: string): PausedWorkflow {
    const current = this.requirePhase("handed_off");
    const resume = current.previous.phase === "paused"
      ? current.previous.resume
      : current.previous;
    return this.commit({
      phase: "paused",
      workflowId: current.workflowId,
      goal: current.goal,
      mode: current.mode,
      createdAt: current.createdAt,
      ...(current.lineageParentId ? { lineageParentId: current.lineageParentId } : {}),
      reason,
      resume,
    });
  }

  private requirePhase<P extends WorkflowSnapshot["phase"]>(
    phase: P,
  ): Extract<WorkflowSnapshot, { phase: P }> {
    if (!this.snapshot || this.snapshot.phase !== phase) {
      throw new Error(`Waves workflow is not in ${phase}`);
    }
    return this.snapshot as Extract<WorkflowSnapshot, { phase: P }>;
  }

  private commit<T extends WorkflowSnapshot>(snapshot: T): T {
    const previousPhase = this.snapshot?.phase;
    this.snapshot = snapshot;
    this.append(snapshot);
    if (previousPhase !== snapshot.phase) {
      this.recordLifecycle({
        workflowId: snapshot.workflowId,
        ...(previousPhase === undefined ? {} : { from: previousPhase }),
        to: snapshot.phase,
        ...("reason" in snapshot ? { reason: snapshot.reason } : {}),
      });
    }
    return snapshot;
  }
}

export function workflowStatusSegment(snapshot: WorkflowSnapshot | undefined): string | undefined {
  if (!snapshot || snapshot.phase === "completed" || snapshot.phase === "cancelled" || snapshot.phase === "handed_off") {
    return undefined;
  }
  if (snapshot.phase === "paused") return "≋ waves:paused";
  if ("integrationTurns" in snapshot) {
    return `≋ waves:${snapshot.phase}·${snapshot.integrationTurns}t·${snapshot.juryRounds}j`;
  }
  return `≋ waves:${snapshot.phase}`;
}

export function workflowAllowsGoalCompletion(snapshot: WorkflowSnapshot | undefined): boolean {
  if (!snapshot || snapshot.phase === "completed" || snapshot.phase === "cancelled" || snapshot.phase === "handed_off") {
    return true;
  }
  if (snapshot.mode !== "goal_attached") return true;
  return snapshot.phase === "awaiting_acceptance";
}
