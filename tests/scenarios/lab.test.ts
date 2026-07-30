import { describe, expect, it } from "vitest";
import { runScenario } from "../../src/scenarios/lab";

describe("ScenarioLab", () => {
  it("captures actual events, duration, and artifacts from a passing scenario", async () => {
    const result = await runScenario({
      name: "passing",
      execute: async ({ emit, artifact }) => {
        emit("started", { owner: "session-1" });
        artifact("/tmp/result.json");
        emit("settled");
      },
      assert: (trace) => {
        expect(trace.events.map((event) => event.type)).toEqual(["started", "settled"]);
      },
    });

    expect(result.outcome).toBe("passed");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.artifactPaths).toEqual(["/tmp/result.json"]);
  });

  it("returns the real assertion failure instead of manufacturing success", async () => {
    const result = await runScenario({
      name: "failing",
      execute: ({ emit }) => { emit("actual"); },
      assert: (trace) => {
        expect(trace.events[0]?.type).toBe("expected");
      },
    });

    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("expected");
  });
});
