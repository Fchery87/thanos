import { describe, expect, it } from "vitest";
import { AgentOrchestrator, type BatchTask } from "../../src/agents/orchestrator";

describe("AgentOrchestrator — adversarial validation", () => {
  it("rejects batches exceeding max width", () => {
    const orch = new AgentOrchestrator();
    const tasks: BatchTask[] = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      type: "explore" as const,
      goal: "test",
    }));
    const result = orch.validateBatch(tasks);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("width");
  });

  it("rejects duplicate task ids", () => {
    const orch = new AgentOrchestrator();
    const result = orch.validateBatch([
      { id: "dup", type: "explore", goal: "a" },
      { id: "dup", type: "explore", goal: "b" },
    ]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("duplicate");
  });

  it("rejects overlapping write scopes (exact match)", () => {
    const orch = new AgentOrchestrator();
    const result = orch.validateBatch([
      { id: "a", type: "build", goal: "write src/", writeScope: ["src/"] },
      { id: "b", type: "build", goal: "also src/", writeScope: ["src/"] },
    ]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("overlapping");
  });

  it("rejects overlapping write scopes (parent-child)", () => {
    const orch = new AgentOrchestrator();
    const result = orch.validateBatch([
      { id: "a", type: "build", goal: "write src/", writeScope: ["src/"] },
      { id: "b", type: "build", goal: "nested", writeScope: ["src/components/"] },
    ]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("overlapping");
  });

  it("allows non-overlapping write scopes", () => {
    const orch = new AgentOrchestrator();
    const result = orch.validateBatch([
      { id: "a", type: "build", goal: "src", writeScope: ["src/"] },
      { id: "b", type: "build", goal: "docs", writeScope: ["docs/"] },
    ]);
    expect(result.valid).toBe(true);
  });

  it("allows read tasks without scopes alongside writers", () => {
    const orch = new AgentOrchestrator();
    const result = orch.validateBatch([
      { id: "a", type: "build", goal: "write", writeScope: ["src/"] },
      { id: "b", type: "explore", goal: "read" },
      { id: "c", type: "build", goal: "docs", writeScope: ["docs/"] },
    ]);
    expect(result.valid).toBe(true);
  });

  it("prevents starting a task that is already completed", () => {
    const orch = new AgentOrchestrator();
    const batch = orch.createBatch("b1", [
      { id: "t1", type: "explore", goal: "test" },
    ]);
    orch.startTask("b1", "t1");
    orch.completeTask("b1", "t1", {
      version: 1, status: "success", summary: "done", findings: [], artifacts: [], escalations: [],
    });
    expect(() => orch.startTask("b1", "t1")).toThrow(/already completed/);
  });

  it("correctly reports batch complete when all tasks finished", () => {
    const orch = new AgentOrchestrator();
    orch.createBatch("b1", [
      { id: "t1", type: "explore", goal: "a" },
      { id: "t2", type: "explore", goal: "b" },
    ]);
    orch.startTask("b1", "t1");
    orch.startTask("b1", "t2");
    expect(orch.isBatchComplete("b1")).toBe(false);
    orch.completeTask("b1", "t1", {
      version: 1, status: "success", summary: "", findings: [], artifacts: [], escalations: [],
    });
    expect(orch.isBatchComplete("b1")).toBe(false);
    orch.completeTask("b1", "t2", {
      version: 1, status: "success", summary: "", findings: [], artifacts: [], escalations: [],
    });
    expect(orch.isBatchComplete("b1")).toBe(true);
  });

  it("canDelegate respects catalog edges", () => {
    const orch = new AgentOrchestrator();
    expect(orch.canDelegate("reviewer", "explore")).toBe(true);
    expect(orch.canDelegate("build", "explore")).toBe(true);
    expect(orch.canDelegate("explore", "explore")).toBe(false);
    expect(orch.canDelegate("oracle", "explore")).toBe(false);
    expect(orch.canDelegate("designer", "explore")).toBe(false);
  });

  it("cancelBatch removes all active tasks", () => {
    const orch = new AgentOrchestrator();
    orch.createBatch("b1", [
      { id: "t1", type: "explore", goal: "a" },
      { id: "t2", type: "explore", goal: "b" },
    ]);
    orch.startTask("b1", "t1");
    orch.startTask("b1", "t2");
    expect(orch.activeRunCount).toBe(2);
    orch.cancelBatch("b1");
    expect(orch.activeRunCount).toBe(0);
  });
});
