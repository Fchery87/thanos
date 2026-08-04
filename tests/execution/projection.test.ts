import { describe, expect, it } from "vitest";
import { reduceRunFacts } from "../../src/execution/projection";

const base = { version: 1 as const, runId: "run", sequence: 1 };

describe("run projection", () => {
  it("reduces the latest delegation and acceptance observations", () => {
    const projection = reduceRunFacts([
      { ...base, kind: "delegation_settled", nodeId: "security", attempt: 1, state: "failed", reason: "timeout" },
      { ...base, sequence: 2, kind: "delegation_settled", nodeId: "security", attempt: 2, state: "accepted" },
      { ...base, sequence: 3, kind: "acceptance_verdict", verdict: "accepted", reasons: [] },
    ]);
    expect(projection?.state).toBe("accepted");
    expect(projection?.delegations).toEqual([{ nodeId: "security", attempt: 2, state: "accepted" }]);
  });

  it("does not report accepted while a delegation remains blocked", () => {
    const projection = reduceRunFacts([
      { ...base, kind: "acceptance_verdict", verdict: "accepted", reasons: [] },
      { ...base, sequence: 2, kind: "delegation_settled", nodeId: "security", attempt: 1, state: "failed", reason: "timeout" },
    ]);
    expect(projection?.state).toBe("blocked");
  });
  it("ignores unsupported fact versions without affecting authority", () => {
    const projection = reduceRunFacts([
      { ...base, version: 99, kind: "acceptance_verdict", verdict: "accepted", reasons: [] },
      { ...base, sequence: 2, kind: "delegation_settled", nodeId: "tests", attempt: 1, state: "accepted" },
    ]);
    expect(projection?.state).toBe("in_progress");
    expect(projection?.warnings).toContain("run projection degraded: unsupported fact version or shape was ignored");
  });
});
