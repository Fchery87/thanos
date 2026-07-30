import { describe, expect, it } from "vitest";
import {
  buildJuryPlan,
  parseJuryVerdict,
  parseWavePlan,
} from "../../src/workflows/runtime";
import { validateWorkflowPlan } from "../../src/workflows/plan";
import type { WavePlan } from "../../src/workflows/types";

function preparedPlan(): WavePlan {
  return {
    ...buildJuryPlan(),
    integration: {
      targetRoots: ["src"],
      capabilities: ["read", "edit", "exec"],
      criteria: [{
        id: "implementation",
        statement: "The requested behavior is implemented and verified",
        evidenceRequired: ["diff", "test"],
      }],
      limits: { maxIntegrationTurns: 12, maxJuryRounds: 3 },
    },
  };
}

describe("enforced workflow definitions", () => {
  it("defines a valid jury DAG with three independent critics and one dependent oracle", () => {
    const plan = preparedPlan();
    expect(validateWorkflowPlan(plan)).toEqual([]);
    expect(plan.nodes.filter((node) => node.dependsOn.length === 0).map((node) => node.id).sort()).toEqual([
      "correctness",
      "security",
      "tests",
    ]);
    expect(plan.nodes.find((node) => node.id === "oracle")?.dependsOn.sort()).toEqual([
      "correctness",
      "security",
      "tests",
    ]);
    expect(plan.nodes.find((node) => node.id === "oracle")?.result?.kind).toBe("structured");
  });

  it("accepts only unambiguous structured jury verdicts", () => {
    expect(parseJuryVerdict({
      verdict: "APPROVE",
      warnings: ["minor naming concern"],
      blockers: [],
    })).toEqual({
      verdict: "APPROVE",
      warnings: ["minor naming concern"],
      blockers: [],
    });
    expect(parseJuryVerdict({
      verdict: "REQUEST_CHANGES",
      warnings: [],
      blockers: [{
        evidence: "src/auth.ts permits an empty token",
        path: "src/auth.ts",
        requiredCorrection: "reject empty tokens",
      }],
    })).toMatchObject({ verdict: "REQUEST_CHANGES" });
    expect(parseJuryVerdict({ verdict: "COMMENT", warnings: [], blockers: [] })).toBeUndefined();
    expect(parseJuryVerdict({
      verdict: "APPROVE",
      warnings: [],
      blockers: [],
      freeFormVerdict: "trust me",
    })).toBeUndefined();
    expect(parseJuryVerdict({ verdict: "APPROVE", warnings: [], blockers: [{ path: "x" }] })).toBeUndefined();
    expect(parseJuryVerdict({ verdict: "REQUEST_CHANGES", warnings: [], blockers: [] })).toBeUndefined();
  });

  it("parses a complete parent Integration Contract with read-only delegated nodes", () => {
    const base = {
      id: "wave",
      goal: "implement",
      maxConcurrency: 2,
      integration: {
        targetRoots: ["src"],
        capabilities: ["read", "edit", "exec"],
        criteria: [{
          id: "implementation",
          statement: "The requested behavior is implemented and verified",
          evidenceRequired: ["diff", "test"],
        }],
        limits: { maxIntegrationTurns: 12, maxJuryRounds: 3 },
      },
      nodes: [{
        id: "inspect",
        agent: "explore",
        task: "inspect the implementation surface",
        dependsOn: [],
        required: true,
      }],
    };
    expect(parseWavePlan(base)).toEqual(base);
  });

  it("rejects writing or unknown specialists supplied by a planner", () => {
    const base = {
      id: "wave",
      goal: "inspect",
      maxConcurrency: 1,
      integration: {
        targetRoots: ["src"],
        capabilities: ["read", "edit"],
        criteria: [{
          id: "implementation",
          statement: "The requested behavior is implemented",
          evidenceRequired: ["diff"],
        }],
        limits: { maxIntegrationTurns: 12, maxJuryRounds: 3 },
      },
      nodes: [{
        id: "root",
        agent: "explore",
        task: "inspect",
        dependsOn: [],
        required: true,
      }],
    };
    expect(parseWavePlan({
      ...base,
      nodes: [{ ...base.nodes[0], agent: "build" }],
    })).toBeUndefined();
    expect(parseWavePlan({
      ...base,
      nodes: [{ ...base.nodes[0], agent: "superuser" }],
    })).toBeUndefined();
    expect(parseWavePlan({
      ...base,
      nodes: [{ ...base.nodes[0], mutates: true, writePaths: ["src"] }],
    })).toBeUndefined();
    expect(parseWavePlan({ ...base, maxConcurrency: 5 })).toBeUndefined();
    expect(parseWavePlan({ ...base, nodes: [] })).toBeUndefined();
  });
});
