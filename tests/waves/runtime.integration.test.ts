import { describe, expect, it } from "vitest";
import { WavesRuntime } from "../../src/waves/runtime";

describe("WavesRuntime", () => {
  it("rejects overlapping write slices in the runtime plan", () => {
    const runtime = new WavesRuntime();
    const accepted = runtime.acceptPlan({
      width: 2,
      maxDepth: 2,
      slices: [
        { id: "a", agent: "worker", goal: "write a", paths: ["src/index.ts"], mode: "write" },
        { id: "b", agent: "worker", goal: "write b", paths: ["src/index.ts"], mode: "write" },
      ],
    });

    expect(accepted.valid).toBe(false);
    expect(accepted.reason).toMatch(/overlap/i);
  });

  it("stops synthesis on blocked or failed write slices", () => {
    const runtime = new WavesRuntime();
    runtime.acceptPlan({
      width: 1,
      maxDepth: 1,
      slices: [
        { id: "a", agent: "worker", goal: "write a", paths: ["src/index.ts"], mode: "write" },
      ],
    });

    runtime.addWave([
      { slice: { id: "a", agent: "worker", goal: "write a", paths: ["src/index.ts"], mode: "write" }, status: "failed", error: "boom" },
    ] as any);

    const outcome = runtime.complete();
    expect(outcome.status).toBe("partial");
    expect(outcome.synthesisNeeded).toBe(true);
    expect(outcome.issues.join("\n")).toMatch(/dependent work halted|boom/i);
  });
});
