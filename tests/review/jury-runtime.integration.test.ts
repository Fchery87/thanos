import { describe, expect, it } from "vitest";
import { runJuryBatch, runJuryRuntime } from "../../src/review/jury-runtime";

describe("jury runtime", () => {
  it("requires all three critics and the oracle before APPROVE", async () => {
    const verdict = await runJuryRuntime({
      critics: {
        "reviewer-correctness": { version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] },
        "reviewer-security": { version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] },
        "reviewer-tests": { version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] },
      },
      oracle: { version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] },
    });

    expect(verdict.verdict).toBe("APPROVE");
  });

  it("fails closed when a critic is missing", async () => {
    const verdict = await runJuryRuntime({
      critics: {
        "reviewer-correctness": { version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] },
        "reviewer-security": { version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] },
      },
      oracle: { version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] },
    });

    expect(verdict.verdict).not.toBe("APPROVE");
    expect(verdict.synthesis).toMatch(/missing critic/i);
  });

  it("fails closed when oracle is missing", async () => {
    const verdict = await runJuryRuntime({
      critics: {
        "reviewer-correctness": { version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] },
        "reviewer-security": { version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] },
        "reviewer-tests": { version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] },
      },
    });

    expect(verdict.verdict).not.toBe("APPROVE");
    expect(verdict.synthesis).toMatch(/oracle/i);
  });

  it("runs the fixed critic batch before oracle", async () => {
    const seen: string[] = [];
    const verdict = await runJuryBatch({
      target: { diff: "diff", baseCommit: "abc123", changedPaths: ["src/file.ts"] },
      execute: async (task) => {
        seen.push(task.id);
        return { version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] };
      },
    });

    expect(seen.slice(0, 3)).toEqual(["reviewer-correctness", "reviewer-security", "reviewer-tests"]);
    expect(seen[3]).toBe("oracle");
    expect(verdict.verdict).toBe("APPROVE");
  });
});
