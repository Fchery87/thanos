import { describe, expect, it } from "vitest";
import { reduceRunFacts } from "../../src/execution/projection";

const base = { version: 1 as const, runId: "run", sequence: 1 };

describe("run projection", () => {
  it("reduces the latest delegation and acceptance observations", () => {
    const projection = reduceRunFacts([
      { ...base, kind: "delegation_settled", nodeId: "security", attempt: 1, state: "failed", reason: "timeout", workflowId: "workflow-a" },
      { ...base, sequence: 2, kind: "delegation_settled", nodeId: "security", attempt: 2, state: "accepted", workflowId: "workflow-a" },
      { ...base, sequence: 3, kind: "acceptance_verdict", verdict: "accepted", reasons: [], workflowId: "workflow-a" },
    ], { workflowId: "workflow-a" });
    expect(projection?.state).toBe("accepted");
    expect(projection?.delegations).toEqual([{ nodeId: "security", attempt: 2, state: "accepted" }]);
  });

  it("does not report accepted while a delegation remains blocked", () => {
    const projection = reduceRunFacts([
      { ...base, kind: "acceptance_verdict", verdict: "accepted", reasons: [], workflowId: "workflow-a" },
      { ...base, sequence: 2, kind: "delegation_settled", nodeId: "security", attempt: 1, state: "failed", reason: "timeout", workflowId: "workflow-a" },
    ], { workflowId: "workflow-a" });
    expect(projection?.state).toBe("blocked");
  });

  it("isolates a workflow from prior workflow facts", () => {
    const projection = reduceRunFacts([
      { ...base, kind: "delegation_settled", nodeId: "security", attempt: 1, state: "failed", reason: "timeout", workflowId: "workflow-a" },
      { ...base, sequence: 2, kind: "acceptance_verdict", verdict: "accepted", reasons: [], workflowId: "workflow-a" },
      { ...base, sequence: 3, kind: "delegation_settled", nodeId: "security", attempt: 1, state: "accepted", workflowId: "workflow-b" },
    ], { workflowId: "workflow-b" });
    expect(projection?.state).toBe("in_progress");
    expect(projection?.delegations).toEqual([{ nodeId: "security", attempt: 1, state: "accepted" }]);
    expect(projection?.acceptance).toBeUndefined();
  });

  it("ignores malformed, unknown, and unsupported fact shapes", () => {
    const projection = reduceRunFacts([
      { ...base, version: 99, kind: "acceptance_verdict", verdict: "accepted", reasons: [] },
      { ...base, sequence: 2, kind: "unknown" },
      { ...base, sequence: 3, kind: "delegation_settled", nodeId: "tests", attempt: 0, state: "accepted" },
      { ...base, sequence: 4, kind: "delegation_settled", nodeId: "tests", attempt: 1, state: "accepted" },
    ]);
    expect(projection?.state).toBe("in_progress");
    expect(projection?.warnings).toContain("run projection degraded: unsupported fact version or shape was ignored");
    expect(projection?.delegations).toEqual([{ nodeId: "tests", attempt: 1, state: "accepted" }]);
  });
});
