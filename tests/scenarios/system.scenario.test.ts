import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateDelegationEvidence, type DelegationEvidenceEnvelope } from "../../src/delegation/evidence";
import { classifyEgress } from "../../src/governance/egress";
import { authorizeRunGrant, issueRunGrant } from "../../src/governance/run-grant";
import { decideCompletionClaim } from "../../src/goal/completion";
import { restoreController } from "../../src/goal/persist";
import { runScenario, type OutcomeTrace, type Scenario } from "../../src/scenarios/lab";
import { SpecEngine } from "../../src/spec/engine";
import type { VerificationResult } from "../../src/spec/verification";
import { WorkflowRunner } from "../../src/workflows/runner";
import { buildJuryPlan } from "../../src/workflows/runtime";
import type { WavePlan, WorkflowPlan } from "../../src/workflows/types";
import { validateWorkflowPlan } from "../../src/workflows/plan";
import { authorizeVia } from "../helpers/authorize";

function semanticResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    criterion: {
      id: "operator",
      statement: "operator criterion",
      evidenceRequired: ["test"],
      source: "semantic_extraction",
    },
    passed: true,
    evidence: ["vitest (exit 0)"],
    missingEvidence: [],
    source: "semantic_extraction",
    ...overrides,
  };
}

function envelope(nodeId: string): DelegationEvidenceEnvelope {
  return {
    requestId: `request-${nodeId}`,
    ownerRunId: "owner-1",
    nodeId,
    runId: `run-${nodeId}`,
    status: "completed",
    launchContractDigest: "a".repeat(64),
    execution: { status: "completed", success: true, exitCode: 0 },
    acceptance: { status: "verified", evidenceStatus: "verified", explicit: true },
    review: { status: "reviewed" },
    effects: { fileMutation: { status: "not-applicable", expected: false, attempted: false } },
    artifacts: [],
    warnings: [],
    residualRisks: [],
  };
}

function expectPassed(trace: OutcomeTrace): void {
  expect(trace.outcome, trace.error).toBe("passed");
}

function makeRepo(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "thanos-scenario-")));
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src/index.ts"), "export {};\n");
  writeFileSync(join(repo, "outside.ts"), "export {};\n");
  git("add", "-A");
  git("commit", "-m", "initial");
  return repo;
}

describe("ScenarioLab system trajectories", () => {
  const scenarios: Scenario[] = [
    {
      name: "fallback template cannot accept operator completion",
      execute: ({ emit }) => {
        const verdict = decideCompletionClaim("done", [semanticResult({
          source: "deterministic_fallback",
          criterion: {
            id: "fallback",
            statement: "generic fallback",
            evidenceRequired: ["test"],
            source: "deterministic_fallback",
          },
        })]);
        emit("completion_decided", verdict);
      },
      assert: ({ events }) => {
        expect(events[0]?.data).toMatchObject({ met: false });
      },
    },
    {
      name: "operator-derived evidence accepts a completion claim",
      execute: ({ emit }) => {
        emit("completion_decided", decideCompletionClaim("verified", [semanticResult()]));
      },
      assert: ({ events }) => {
        expect(events[0]?.data).toEqual({ met: true, reason: "verified" });
      },
    },
    {
      name: "goal reentry restores intent paused",
      execute: ({ emit }) => {
        emit("goal_restored", restoreController({ condition: "ship" }, undefined, () => 1, 0).snapshot());
      },
      assert: ({ events }) => {
        expect(events[0]?.data).toMatchObject({ condition: "ship", status: "paused" });
      },
    },
    {
      name: "incomplete V2 response remains awaiting evidence",
      execute: ({ emit }) => {
        emit("delegation_checked", validateDelegationEvidence({
          requestId: "r",
          ownerRunId: "o",
          nodeId: "n",
          status: "completed",
        }, { requestId: "r", ownerRunId: "o", nodeId: "n" }));
      },
      assert: ({ events }) => {
        expect(events[0]?.data).toMatchObject({ state: "awaiting_evidence" });
      },
    },
    {
      name: "compound network shell is classified as egress",
      execute: ({ emit }) => {
        emit("egress_classified", classifyEgress("bash", { command: "echo ready && curl https://example.com" }));
      },
      assert: ({ events }) => {
        expect(events[0]?.data).not.toBe("none");
      },
    },
    {
      name: "unattended shell cannot run without attended verification",
      execute: async ({ emit }) => {
        emit("authorized", await authorizeVia(
          { autonomy: "unattended", hasUI: false },
          "bash",
          { command: "npm test" },
        ));
      },
      assert: ({ events }) => {
        expect(events[0]?.data).toMatchObject({ block: true });
      },
    },
    {
      name: "workflow rejects a dependency cycle before launch",
      execute: ({ emit }) => {
        const plan: WorkflowPlan = {
          id: "cycle", goal: "x", maxConcurrency: 2,
          nodes: [
            { id: "a", agent: "explore", task: "a", dependsOn: ["b"], required: true },
            { id: "b", agent: "explore", task: "b", dependsOn: ["a"], required: true },
          ],
        };
        emit("plan_validated", validateWorkflowPlan(plan));
      },
      assert: ({ events }) => {
        expect(events[0]?.data).toEqual(expect.arrayContaining([expect.stringMatching(/cycle/i)]));
      },
    },
    {
      name: "jury oracle starts only after every critic settles",
      execute: async ({ emit }) => {
        const starts: string[] = [];
        const runner = new WorkflowRunner(async (node) => {
          starts.push(node.id);
          emit("node_accepted", node.id);
          return { state: "accepted", envelope: envelope(node.id) };
        });
        const result = await runner.run(buildJuryPlan());
        emit("workflow_settled", { starts, state: result.state });
      },
      assert: ({ events }) => {
        const final = events.at(-1)?.data as { starts: string[]; state: string };
        expect(final.state).toBe("completed");
        expect(final.starts.at(-1)).toBe("oracle");
        expect(new Set(final.starts.slice(0, 3))).toEqual(new Set(["correctness", "security", "tests"]));
      },
    },
    {
      name: "workflow evidence reaches operator verification",
      execute: ({ emit }) => {
        const plan: WavePlan = {
          id: "read-review", goal: "review", maxConcurrency: 1,
          integration: {
            targetRoots: ["src"],
            capabilities: ["read", "edit", "exec"],
            criteria: [{
              id: "reviewed-change",
              statement: "The requested change is implemented and verified",
              evidenceRequired: ["diff", "test"],
            }],
            limits: { maxIntegrationTurns: 12, maxJuryRounds: 3 },
          },
          nodes: [{ id: "review", agent: "explore", task: "review", dependsOn: [], required: true }],
        };
        const spec = new SpecEngine();
        spec.startTurn("Review the billing implementation", true);
        spec.bindWorkflowPlan(plan);
        const accepted = envelope("review");
        spec.recordWorkflowEvidenceRefs(plan, [{
          nodeId: "review",
          requestId: accepted.requestId,
          ownerRunId: accepted.ownerRunId,
          runId: accepted.runId,
          launchContractDigest: accepted.launchContractDigest,
          artifacts: accepted.artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
        }], { accepted: true, reasons: [] });
        emit("spec_verified", spec.verify().find((result) => result.criterion.id === "workflow:read-review"));
      },
      assert: ({ events }) => {
        expect(events[0]?.data).toMatchObject({ passed: true });
      },
    },
    {
      name: "Run Grant blocks an out-of-root structured edit",
      execute: async ({ emit }) => {
        const repo = makeRepo();
        try {
          const grant = await issueRunGrant({
            repoDir: repo,
            runId: "run-1",
            contractRevision: "revision-1",
            capabilities: ["edit"],
            targetRoots: ["src"],
          });
          emit("grant_checked", await authorizeRunGrant(grant, {
            repoDir: repo,
            contractRevision: "revision-1",
            capability: "edit",
            target: "outside.ts",
          }));
        } finally {
          rmSync(repo, { recursive: true, force: true });
        }
      },
      assert: ({ events }) => {
        expect(events[0]?.data).toMatchObject({ allowed: false });
      },
    },
  ];

  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      expectPassed(await runScenario(scenario));
    });
  }
});
