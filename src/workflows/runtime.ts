import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { agentWrites, getAllIds } from "../agents/catalog";
import { DelegationRuntime, type DelegationOutcome } from "../delegation/runtime";
import type { DelegationEvidenceEnvelope } from "../delegation/evidence";
import { WorkflowRunner } from "./runner";
import { validateWorkflowPlan } from "./plan";
import { verifyEvidenceArtifacts } from "./artifacts";
import type {
  IntegrationContract,
  IntegrationCriterion,
  WavePlan,
  WorkflowNode,
  WorkflowPlan,
  WorkflowRunResult,
} from "./types";
import type { WorkflowEvidenceRef } from "./state";

const knownAgents = new Set<string>(getAllIds());

function ownerRunId(ctx: ExtensionContext): string {
  const identity = ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId();
  if (!identity) throw new Error("Current Pi session identity is unavailable");
  return identity;
}

function resultText(envelope: DelegationEvidenceEnvelope): string {
  if (envelope.result?.kind === "text") return envelope.result.text;
  if (envelope.result?.kind === "structured") return JSON.stringify(envelope.result.value);
  return "";
}

function priorEvidence(prior: ReadonlyMap<string, { outcome: DelegationOutcome }>): string {
  const evidence = [...prior.entries()].flatMap(([id, result]) =>
    result.outcome.state === "accepted"
      ? [`## ${id}\n${resultText(result.outcome.envelope)}`]
      : [],
  );
  return evidence.length > 0 ? `\n\nPrior required-node evidence:\n\n${evidence.join("\n\n")}` : "";
}

function restoredEvidence(references: WorkflowEvidenceRef[]): string {
  const artifacts = references.flatMap((reference) =>
    reference.artifacts.map((artifact) => `${reference.nodeId}: sha256:${artifact.sha256}`));
  return artifacts.length > 0
    ? `\n\nPreviously verified sibling artifact digests (paths are deliberately withheld):\n${artifacts.join("\n")}`
    : "";
}

export async function createWorkflowRunner(
  pi: Pick<ExtensionAPI, "events">,
  ctx: ExtensionContext,
  signal?: AbortSignal,
  acceptedReferences: WorkflowEvidenceRef[] = [],
  onSettled?: (node: WorkflowNode, outcome: DelegationOutcome) => void,
): Promise<WorkflowRunner> {
  const delegation = new DelegationRuntime(pi.events, ownerRunId(ctx));
  const verification = await verifyEvidenceArtifacts(ctx.cwd, acceptedReferences);
  return new WorkflowRunner(async (node, prior) => {
    if (!verification.valid) {
      return Promise.resolve({
        state: "failed",
        reason: `restored evidence invalid: ${verification.reasons.join("; ")}`,
      });
    }
    const outcome = await delegation.delegate({
      nodeId: node.id,
      agent: node.agent,
      task: `${node.task}${priorEvidence(prior)}${restoredEvidence(acceptedReferences)}`,
      context: "fresh",
      cwd: ctx.cwd,
      acceptance: "checked",
      artifacts: true,
      result: node.result ?? { kind: "text" },
      timeoutMs: 120_000,
      turnBudget: { maxTurns: 12, graceTurns: 1 },
    }, signal);
    if (outcome.state !== "accepted" || outcome.envelope.artifacts.length === 0) return outcome;
    const artifacts = await verifyEvidenceArtifacts(ctx.cwd, [{
      nodeId: outcome.envelope.nodeId,
      requestId: outcome.envelope.requestId,
      ownerRunId: outcome.envelope.ownerRunId,
      runId: outcome.envelope.runId,
      launchContractDigest: outcome.envelope.launchContractDigest,
      artifacts: outcome.envelope.artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
    }]);
    return artifacts.valid
      ? outcome
      : { state: "awaiting_evidence", reasons: artifacts.reasons };
  }, { onSettled });
}

export function buildJuryPlan(): WorkflowPlan {
  const critic = (id: string, agent: string, task: string): WorkflowNode => ({
    id,
    agent,
    task,
    dependsOn: [],
    required: true,
  });
  return {
    id: "jury",
    goal: "Review the current change with independent critics and a devil's advocate",
    maxConcurrency: 3,
    nodes: [
      critic("correctness", "reviewer-correctness", "Review the current changes for correctness bugs and regressions. Return only evidence-backed findings."),
      critic("security", "reviewer-security", "Review the current changes for security, privacy, policy-bypass, and trust-boundary risks."),
      critic("tests", "reviewer-tests", "Review whether the current changes have sufficient and truthful verification."),
      {
        id: "oracle",
        agent: "oracle",
        task: "Challenge every critic result. Mark claims KEEP, WEAKEN, or DROP; identify missed risks; then return the required structured APPROVE or REQUEST_CHANGES verdict. Warnings are nonblocking. Every blocker must cite evidence, an affected path, and the required correction.",
        dependsOn: ["correctness", "security", "tests"],
        required: true,
        result: { kind: "structured", schema: JURY_VERDICT_SCHEMA },
      },
    ],
  };
}

export const JURY_VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "warnings", "blockers"],
  properties: {
    verdict: { type: "string", enum: ["APPROVE", "REQUEST_CHANGES"] },
    warnings: { type: "array", items: { type: "string" } },
    blockers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidence", "path", "requiredCorrection"],
        properties: {
          evidence: { type: "string" },
          path: { type: "string" },
          requiredCorrection: { type: "string" },
        },
      },
    },
  },
} as const;

export interface JuryBlocker {
  evidence: string;
  path: string;
  requiredCorrection: string;
}

export type JuryVerdict =
  | { verdict: "APPROVE"; warnings: string[]; blockers: [] }
  | { verdict: "REQUEST_CHANGES"; warnings: string[]; blockers: JuryBlocker[] };

export function parseJuryVerdict(value: unknown): JuryVerdict | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(raw, new Set(["verdict", "warnings", "blockers"]))
    || !Array.isArray(raw.warnings)
    || !raw.warnings.every((warning) => typeof warning === "string")
    || !Array.isArray(raw.blockers)
  ) return undefined;
  const blockers: JuryBlocker[] = [];
  for (const value of raw.blockers) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const blocker = value as Record<string, unknown>;
    if (
      !hasOnlyKeys(blocker, new Set(["evidence", "path", "requiredCorrection"]))
      || typeof blocker.evidence !== "string"
      || !blocker.evidence.trim()
      || typeof blocker.path !== "string"
      || !blocker.path.trim()
      || typeof blocker.requiredCorrection !== "string"
      || !blocker.requiredCorrection.trim()
    ) return undefined;
    blockers.push({
      evidence: blocker.evidence,
      path: blocker.path,
      requiredCorrection: blocker.requiredCorrection,
    });
  }
  const warnings = raw.warnings as string[];
  if (raw.verdict === "APPROVE" && blockers.length === 0) {
    return { verdict: "APPROVE", warnings, blockers: [] };
  }
  if (raw.verdict === "REQUEST_CHANGES" && blockers.length > 0) {
    return { verdict: "REQUEST_CHANGES", warnings, blockers };
  }
  return undefined;
}

export function juryVerdictFromResult(result: WorkflowRunResult): JuryVerdict | undefined {
  const oracle = result.results.find(({ node }) => node.id === "oracle");
  if (oracle?.outcome.state !== "accepted") return undefined;
  const value = oracle.outcome.envelope.result;
  return value?.kind === "structured" ? parseJuryVerdict(value.value) : undefined;
}

export async function runJuryWorkflow(
  pi: Pick<ExtensionAPI, "events">,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<WorkflowRunResult> {
  const runner = await createWorkflowRunner(pi, ctx, signal);
  return runner.run(buildJuryPlan());
}

export const WAVE_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "goal", "maxConcurrency", "integration", "nodes"],
  properties: {
    id: { type: "string" },
    goal: { type: "string" },
    maxConcurrency: { type: "integer", minimum: 1, maximum: 4 },
    integration: {
      type: "object",
      additionalProperties: false,
      required: ["targetRoots", "capabilities", "criteria", "limits"],
      properties: {
        targetRoots: { type: "array", minItems: 1, items: { type: "string" } },
        capabilities: {
          type: "array",
          minItems: 1,
          items: { type: "string", enum: ["read", "edit", "exec", "task", "interaction"] },
        },
        criteria: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "statement", "evidenceRequired"],
            properties: {
              id: { type: "string" },
              statement: { type: "string" },
              evidenceRequired: {
                type: "array",
                minItems: 1,
                items: { type: "string", enum: ["diff", "test", "command"] },
              },
              evidenceAnyOf: {
                type: "array",
                items: {
                  type: "array",
                  minItems: 1,
                  items: { type: "string", enum: ["diff", "test", "command"] },
                },
              },
            },
          },
        },
        limits: {
          type: "object",
          additionalProperties: false,
          required: ["maxIntegrationTurns", "maxJuryRounds"],
          properties: {
            maxIntegrationTurns: { type: "integer", minimum: 1, maximum: 100 },
            maxJuryRounds: { type: "integer", minimum: 1, maximum: 20 },
          },
        },
      },
    },
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "agent", "task", "dependsOn", "required"],
        properties: {
          id: { type: "string" },
          agent: { type: "string" },
          task: { type: "string" },
          dependsOn: { type: "array", items: { type: "string" } },
          required: { type: "boolean" },
        },
      },
    },
  },
} as const;

const CAPABILITIES = new Set(["read", "edit", "exec", "task", "interaction"]);
const INTEGRATION_EVIDENCE = new Set(["diff", "test", "command"]);

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseCriterion(value: unknown): IntegrationCriterion | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(raw, new Set(["id", "statement", "evidenceRequired", "evidenceAnyOf"]))
    || typeof raw.id !== "string"
    || typeof raw.statement !== "string"
    || !Array.isArray(raw.evidenceRequired)
    || raw.evidenceRequired.length === 0
    || !raw.evidenceRequired.every((item) => typeof item === "string" && INTEGRATION_EVIDENCE.has(item))
  ) return undefined;
  if (
    raw.evidenceAnyOf !== undefined
    && (
      !Array.isArray(raw.evidenceAnyOf)
      || !raw.evidenceAnyOf.every((group) =>
        Array.isArray(group)
        && group.length > 0
        && group.every((item) => typeof item === "string" && INTEGRATION_EVIDENCE.has(item)))
    )
  ) return undefined;
  return {
    id: raw.id,
    statement: raw.statement,
    evidenceRequired: raw.evidenceRequired as IntegrationCriterion["evidenceRequired"],
    ...(raw.evidenceAnyOf === undefined
      ? {}
      : { evidenceAnyOf: raw.evidenceAnyOf as IntegrationCriterion["evidenceAnyOf"] }),
  };
}

function parseIntegration(value: unknown): IntegrationContract | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const limits = raw.limits && typeof raw.limits === "object" && !Array.isArray(raw.limits)
    ? raw.limits as Record<string, unknown>
    : undefined;
  const criteria = Array.isArray(raw.criteria) ? raw.criteria.map(parseCriterion) : [];
  if (
    !hasOnlyKeys(raw, new Set(["targetRoots", "capabilities", "criteria", "limits"]))
    || !Array.isArray(raw.targetRoots)
    || raw.targetRoots.length === 0
    || !raw.targetRoots.every((item) => typeof item === "string" && item.trim().length > 0)
    || !Array.isArray(raw.capabilities)
    || raw.capabilities.length === 0
    || !raw.capabilities.every((item) => typeof item === "string" && CAPABILITIES.has(item))
    || !Array.isArray(raw.criteria)
    || raw.criteria.length === 0
    || criteria.some((criterion) => criterion === undefined)
    || !limits
    || !hasOnlyKeys(limits, new Set(["maxIntegrationTurns", "maxJuryRounds"]))
    || !Number.isInteger(limits.maxIntegrationTurns)
    || Number(limits.maxIntegrationTurns) < 1
    || Number(limits.maxIntegrationTurns) > 100
    || !Number.isInteger(limits.maxJuryRounds)
    || Number(limits.maxJuryRounds) < 1
    || Number(limits.maxJuryRounds) > 20
  ) return undefined;
  return {
    targetRoots: raw.targetRoots as string[],
    capabilities: raw.capabilities as IntegrationContract["capabilities"],
    criteria: criteria as IntegrationCriterion[],
    limits: {
      maxIntegrationTurns: Number(limits.maxIntegrationTurns),
      maxJuryRounds: Number(limits.maxJuryRounds),
    },
  };
}

export function parseWavePlan(value: unknown): WavePlan | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(raw, new Set(["id", "goal", "maxConcurrency", "integration", "nodes"]))
    || typeof raw.id !== "string"
    || typeof raw.goal !== "string"
    || !Number.isInteger(raw.maxConcurrency)
    || !Array.isArray(raw.nodes)
  ) {
    return undefined;
  }
  const integration = parseIntegration(raw.integration);
  if (!integration) return undefined;
  const nodes: WorkflowNode[] = [];
  for (const entry of raw.nodes) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const node = entry as Record<string, unknown>;
    if (
      !hasOnlyKeys(node, new Set(["id", "agent", "task", "dependsOn", "required"]))
      || typeof node.id !== "string"
      || typeof node.agent !== "string"
      || !knownAgents.has(node.agent)
      || agentWrites(node.agent)
      || typeof node.task !== "string"
      || !Array.isArray(node.dependsOn)
      || !node.dependsOn.every((item) => typeof item === "string")
      || typeof node.required !== "boolean"
    ) return undefined;
    nodes.push({
      id: node.id,
      agent: node.agent,
      task: node.task,
      dependsOn: node.dependsOn as string[],
      required: node.required,
    });
  }
  const plan: WavePlan = {
    id: raw.id,
    goal: raw.goal,
    maxConcurrency: raw.maxConcurrency as number,
    integration,
    nodes,
  };
  return validateWorkflowPlan(plan).length === 0 ? plan : undefined;
}

export type WavePlanningResult =
  | { state: "planned"; plan: WavePlan }
  | { state: "awaiting_evidence" | "invalid_plan"; reasons: string[] };

export async function planWavesWorkflow(
  pi: Pick<ExtensionAPI, "events">,
  ctx: ExtensionContext,
  goal: string,
  signal?: AbortSignal,
): Promise<WavePlanningResult> {
  const delegation = new DelegationRuntime(pi.events, ownerRunId(ctx));
  const planning = await delegation.delegate({
    nodeId: "wave_plan",
    agent: "plan",
    task:
      `Create a bounded execution DAG for this goal: ${goal}\n` +
      "Use at most eight delegated investigation nodes, all assigned to known read-only specialists. " +
      "Also return one parent integration contract with bounded target roots, capabilities, machine-verifiable criteria, " +
      "maxIntegrationTurns=12, and maxJuryRounds=3. Delegated nodes return evidence only; the main session owns all mutation.",
    context: "fresh",
    cwd: ctx.cwd,
    acceptance: "checked",
    artifacts: true,
    result: { kind: "structured", schema: WAVE_PLAN_SCHEMA },
    timeoutMs: 120_000,
    turnBudget: { maxTurns: 8, graceTurns: 1 },
    toolBudget: { hard: 20 },
  }, signal);
  if (planning.state !== "accepted") {
    return {
      state: "awaiting_evidence",
      reasons: planning.state === "awaiting_evidence" ? planning.reasons : [planning.reason],
    };
  }
  const result = planning.envelope.result;
  const plan = result?.kind === "structured" ? parseWavePlan(result.value) : undefined;
  return plan
    ? { state: "planned", plan }
    : { state: "invalid_plan", reasons: ["planner returned an invalid WavePlan"] };
}

export function workflowEvidenceRefs(result: WorkflowRunResult): WorkflowEvidenceRef[] {
  return result.results.flatMap(({ node, outcome }) =>
    outcome.state === "accepted"
      ? [{
          nodeId: node.id,
          requestId: outcome.envelope.requestId,
          ownerRunId: outcome.envelope.ownerRunId,
          runId: outcome.envelope.runId,
          launchContractDigest: outcome.envelope.launchContractDigest,
          artifacts: outcome.envelope.artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
        }]
      : [],
  );
}

export function buildIntegrationDirective(
  plan: WavePlan,
  result: WorkflowRunResult,
  acceptedReferences: WorkflowEvidenceRef[] = [],
): string {
  const evidence = result.results.flatMap(({ node, outcome }) => {
    if (outcome.state !== "accepted") return [];
    const text = resultText(outcome.envelope).trim();
    const artifacts = outcome.envelope.artifacts
      .map(({ sha256 }) => `sha256:${sha256}`)
      .join(", ");
    return [
      `## ${node.id} (${node.agent})`,
      text || "(no inline result; use the artifact references)",
      ...(artifacts ? [`Artifacts: ${artifacts}`] : []),
    ].join("\n");
  }).join("\n\n");
  const boundedEvidence = evidence.length > 32_000
    ? `${evidence.slice(0, 32_000)}\n\n[Evidence text truncated; verified artifact digests are retained as metadata only.]`
    : evidence;
  const currentArtifactDigests = result.results.flatMap(({ node, outcome }) =>
    outcome.state === "accepted"
      ? outcome.envelope.artifacts.map((artifact) => `${node.id}: sha256:${artifact.sha256}`)
      : []);
  const preservedArtifacts = [...new Set([
    ...currentArtifactDigests,
    ...acceptedReferences.flatMap((reference) =>
      reference.artifacts.map((artifact) => `${reference.nodeId}: sha256:${artifact.sha256}`)),
  ])];
  return [
    "[harness:waves-integrate] You are the Integration Owner for the approved Waves Work Contract.",
    `Goal: ${plan.goal}`,
    `Write only within: ${plan.integration.targetRoots.join(", ")}`,
    `Remaining total integration budget starts at ${plan.integration.limits.maxIntegrationTurns} turns.`,
    "Integrate the accepted read-only investigation evidence below. Do not delegate mutation.",
    "When this exact repository revision is ready for jury review, call workflow_yield. Natural turn completion is not a yield.",
    "",
    boundedEvidence,
    ...(preservedArtifacts.length > 0
      ? ["", "Verified artifact digests (source paths withheld):", ...preservedArtifacts]
      : []),
  ].join("\n");
}

export function formatWorkflowOutcome(result: WorkflowRunResult): string {
  if (result.state === "completed") {
    const final = result.results.at(-1);
    if (final?.outcome.state === "accepted") return resultText(final.outcome.envelope) || "Workflow completed with verified evidence.";
    return "Workflow completed with verified evidence.";
  }
  return `${result.state}: ${result.reasons.join("; ")}`;
}
