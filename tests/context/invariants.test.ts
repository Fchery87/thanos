import { describe, expect, it } from "vitest";
import {
  buildInvariantContent,
  reconcileInvariantTail,
  INVARIANT_TAIL_ID,
  INVARIANT_TAIL_CUSTOM_TYPE,
  type InvariantTailDeps,
} from "../../src/context/invariants";
import { GoalController } from "../../src/goal/controller";
import { SpecEngine } from "../../src/spec/engine";
import { WorkflowRuntime } from "../../src/workflows/state";
import type { WavePlan } from "../../src/workflows/types";

function makeDeps(): InvariantTailDeps {
  return {
    goalController: new GoalController(),
    spec: new SpecEngine(),
    workflowRuntime: new WorkflowRuntime(),
  };
}

function userMessage(content: string) {
  return { role: "user" as const, content: [{ type: "text" as const, text: content }], timestamp: 0 };
}

const plan: WavePlan = {
  id: "wave",
  goal: "implement",
  maxConcurrency: 1,
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
  nodes: [{ id: "inspect", agent: "explore", task: "inspect", dependsOn: [], required: true }],
};

describe("reconcileInvariantTail", () => {
  it("returns undefined and leaves messages untouched when no goal, spec, or workflow is active", () => {
    const deps = makeDeps();
    const messages = [userMessage("hello")];
    expect(reconcileInvariantTail(messages, deps)).toBeUndefined();
  });

  it("leaves messages untouched even if a stale invariant block from an earlier active state remains — ordinary chat pays nothing", () => {
    const deps = makeDeps();
    const staleBlock = {
      role: "custom" as const,
      customType: INVARIANT_TAIL_CUSTOM_TYPE,
      content: `id:${INVARIANT_TAIL_ID}\norigin:harness\nauthority:instruction\nscope:session\nsource:context-invariants\ntrusted:true\ncontent:"stale"`,
      display: false,
      timestamp: 0,
    };
    // Nothing active now (fresh deps) — the hook must not even look at, let
    // alone strip, a pre-existing block.
    expect(reconcileInvariantTail([userMessage("hi"), staleBlock], deps)).toBeUndefined();
  });

  it("appends exactly one block when messages are missing it, with an active goal", () => {
    const deps = makeDeps();
    deps.goalController.set("Ship the feature", 0);

    const result = reconcileInvariantTail([userMessage("hi")], deps);

    expect(result).toBeDefined();
    expect(result).toHaveLength(2);
    const added = result![1] as { role: string; customType: string; content: string; display: boolean };
    expect(added.role).toBe("custom");
    expect(added.customType).toBe(INVARIANT_TAIL_CUSTOM_TYPE);
    expect(added.display).toBe(false);
    expect(added.content.startsWith(`id:${INVARIANT_TAIL_ID}\n`)).toBe(true);
    expect(added.content).toContain("Ship the feature");
  });

  it("ends with exactly one block, stripping a stale copy first, when the active state has moved on", () => {
    const deps = makeDeps();
    deps.goalController.set("Ship the feature A", 0);
    const staleButSameId = {
      role: "custom" as const,
      customType: INVARIANT_TAIL_CUSTOM_TYPE,
      content: `id:${INVARIANT_TAIL_ID}\norigin:harness\nauthority:instruction\nscope:session\nsource:context-invariants\ntrusted:true\ncontent:"outdated goal text"`,
      display: false,
      timestamp: 0,
    };

    const result = reconcileInvariantTail([userMessage("hi"), staleButSameId], deps);

    expect(result).toBeDefined();
    const invariantCopies = result!.filter((m) => {
      const c = m as { role?: unknown; content?: unknown };
      return c.role === "custom" && typeof c.content === "string" && c.content.startsWith(`id:${INVARIANT_TAIL_ID}\n`);
    });
    expect(invariantCopies).toHaveLength(1);
    expect((invariantCopies[0] as { content: string }).content).toContain("Ship the feature A");
    expect((invariantCopies[0] as { content: string }).content).not.toContain("outdated goal text");
  });

  it("is idempotent: firing again with the exact same state and the already-restored block returns undefined (no churn)", () => {
    const deps = makeDeps();
    deps.goalController.set("Ship the feature", 0);

    const first = reconcileInvariantTail([userMessage("hi")], deps);
    expect(first).toBeDefined();

    const second = reconcileInvariantTail(first!, deps);
    expect(second).toBeUndefined();
  });

  it("restores the block after it goes missing (simulating compaction deleting it) with fresh content", () => {
    const deps = makeDeps();
    deps.goalController.set("Ship the feature", 0);

    const withBlock = reconcileInvariantTail([userMessage("hi")], deps)!;
    // Compaction deletes everything before a cut point — simulate it deleting
    // the invariant message along with the rest of the early history.
    const afterCompaction = withBlock.filter((m) => {
      const c = m as { role?: unknown };
      return c.role !== "custom";
    });
    expect(afterCompaction.some((m) => (m as { role?: unknown }).role === "custom")).toBe(false);

    const restored = reconcileInvariantTail(afterCompaction, deps);
    expect(restored).toBeDefined();
    const added = restored!.at(-1) as { customType: string; content: string };
    expect(added.customType).toBe(INVARIANT_TAIL_CUSTOM_TYPE);
    expect(added.content).toContain("Ship the feature");
  });

  it("covers spec and workflow, not just goal", () => {
    const deps = makeDeps();
    deps.spec.startTurn("Rename the User class to Account across the codebase", false);
    deps.workflowRuntime.start({ goal: "implement", mode: "standalone" });

    const result = reconcileInvariantTail([], deps);
    expect(result).toBeDefined();
    const added = result!.at(-1) as { content: string };
    expect(added.content).toContain("Requested rename is applied consistently");
    expect(added.content).toContain("Active Waves workflow stage: Planning.");
  });

  it("re-fires correctly as a workflow advances phase mid-run, without duplicate blocks", () => {
    const deps = makeDeps();
    deps.workflowRuntime.start({ goal: "implement", mode: "standalone" });

    const afterPlanning = reconcileInvariantTail([], deps)!;
    expect((afterPlanning.at(-1) as { content: string }).content).toContain("Planning");

    deps.workflowRuntime.bindPlan(plan);
    const afterApproval = reconcileInvariantTail(afterPlanning, deps)!;
    const copies = afterApproval.filter((m) => {
      const c = m as { role?: unknown; content?: unknown };
      return c.role === "custom" && typeof c.content === "string" && c.content.startsWith(`id:${INVARIANT_TAIL_ID}\n`);
    });
    expect(copies).toHaveLength(1);
    expect((copies[0] as { content: string }).content).toContain("Awaiting Approval");
    expect((copies[0] as { content: string }).content).not.toContain("Active Waves workflow stage: Planning.");
  });
});

describe("buildInvariantContent", () => {
  it("returns undefined when nothing is active", () => {
    expect(buildInvariantContent(makeDeps())).toBeUndefined();
  });

  it("round-trips through the rendered envelope byte-identical to what it produced", () => {
    const deps = makeDeps();
    deps.goalController.set("Ship the feature", 0);
    deps.spec.startTurn("Rename the User class to Account across the codebase", false);
    deps.workflowRuntime.start({ goal: "implement", mode: "standalone" });

    const raw = buildInvariantContent(deps);
    expect(raw).toBeDefined();

    const result = reconcileInvariantTail([], deps)!;
    const added = result.at(-1) as { content: string };
    const contentLine = added.content.split("\n").find((line) => line.startsWith("content:")) as string;
    const decoded = JSON.parse(contentLine.slice("content:".length)) as string;

    expect(decoded).toBe(raw);
  });
});
