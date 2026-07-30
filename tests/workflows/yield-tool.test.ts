import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerWorkflowYieldTool } from "../../src/workflows/tool";
import { WorkflowRuntime } from "../../src/workflows/state";
import type { WavePlan } from "../../src/workflows/types";

const plan: WavePlan = {
  id: "wave",
  goal: "implement",
  maxConcurrency: 1,
  integration: {
    targetRoots: ["src"],
    capabilities: ["read", "edit", "exec"],
    criteria: [{ id: "done", statement: "Done", evidenceRequired: ["diff", "test"] }],
    limits: { maxIntegrationTurns: 12, maxJuryRounds: 3 },
  },
  nodes: [{ id: "inspect", agent: "explore", task: "inspect", dependsOn: [], required: true }],
};

function integrating(): WorkflowRuntime {
  const runtime = new WorkflowRuntime({ createId: () => "workflow-1", now: () => 42 });
  runtime.start({ goal: "implement", mode: "standalone" });
  runtime.bindPlan(plan);
  runtime.approve();
  runtime.completeInvestigation([]);
  return runtime;
}

describe("workflow_yield tool", () => {
  it("binds readiness to the captured repository revision", async () => {
    type ToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];
    const tools = new Map<string, ToolDefinition>();
    const runtime = integrating();
    const revision = { head: "a".repeat(40), workingTree: [["src/a.ts", "M hash"]] as Array<[string, string]> };
    registerWorkflowYieldTool({
      registerTool: (definition: ToolDefinition) => {
        tools.set(definition.name, definition);
      },
    } as Pick<ExtensionAPI, "registerTool">, {
      runtime,
      captureRevision: vi.fn(async () => revision),
    });

    const result = await tools.get("workflow_yield")?.execute(
      "call-1",
      {},
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );
    expect(result).not.toMatchObject({ isError: true });
    expect(runtime.current).toMatchObject({
      phase: "reviewing",
      juryRounds: 1,
      yieldIdentity: revision,
    });
  });

  it("pauses when repository identity cannot be established", async () => {
    type ToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];
    const tools = new Map<string, ToolDefinition>();
    const runtime = integrating();
    registerWorkflowYieldTool({
      registerTool: (definition: ToolDefinition) => {
        tools.set(definition.name, definition);
      },
    } as Pick<ExtensionAPI, "registerTool">, {
      runtime,
      captureRevision: vi.fn(async () => undefined),
    });

    const result = await tools.get("workflow_yield")?.execute(
      "call-1",
      {},
      undefined,
      undefined,
      { cwd: "/repo" } as unknown as ExtensionContext,
    );
    expect(result).toMatchObject({ isError: true });
    expect(runtime.current).toMatchObject({
      phase: "paused",
      reason: "repository_revision_unavailable",
    });
  });
});
