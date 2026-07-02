import { describe, expect, it } from "vitest";
import { validateWavePlan } from "../../src/waves/plan";

describe("validateWavePlan", () => {
  it("accepts independent read-only slices", () => {
    expect(() => validateWavePlan({
      width: 3,
      maxDepth: 2,
      slices: [
        { id: "docs", agent: "explore", goal: "Audit docs", paths: ["docs"], mode: "read" },
        { id: "tests", agent: "explore", goal: "Audit tests", paths: ["tests"], mode: "read" },
      ],
    })).not.toThrow();
  });

  it("rejects overlapping write slices", () => {
    expect(() => validateWavePlan({
      width: 2,
      maxDepth: 2,
      slices: [
        { id: "a", agent: "worker", goal: "Edit file", paths: ["src/index.ts"], mode: "write" },
        { id: "b", agent: "worker", goal: "Also edit file", paths: ["src/index.ts"], mode: "write" },
      ],
    })).toThrow(/overlap/i);
  });

  it("caps wave width and depth", () => {
    expect(() => validateWavePlan({ width: 9, maxDepth: 4, slices: [] })).toThrow(/bounded/i);
  });

  it("requires write slices to use worktree-isolated writer agents", () => {
    expect(() => validateWavePlan({
      width: 1,
      maxDepth: 2,
      slices: [
        { id: "review", agent: "reviewer", goal: "Edit reviewed file", paths: ["src/index.ts"], mode: "write" },
      ],
    })).toThrow(/writer/i);
  });
});
