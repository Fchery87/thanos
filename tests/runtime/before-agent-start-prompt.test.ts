import { describe, expect, it } from "vitest";
import { assembleSystemPrompt } from "../../src/runtime/prompt-assembly";

describe("assembleSystemPrompt", () => {
  it("folds the base system prompt in first, then Thanos static blocks", () => {
    const out = assembleSystemPrompt({
      baseSystemPrompt: "BASE-<available_skills>...</available_skills>",
      isSubagent: false,
      trustedInstructions: ["TRUSTED"],
      skillsDirective: "SKILLS",
      roster: "- explore: search",
    });
    expect(out.systemPrompt.startsWith("BASE-")).toBe(true);
    expect(out.systemPrompt).toContain("TRUSTED");
    expect(out.systemPrompt).toContain("- explore: search");
  });

  it("keeps dynamic content (memories, goal) OUT of systemPrompt", () => {
    const out = assembleSystemPrompt({
      baseSystemPrompt: "BASE",
      isSubagent: false,
      trustedInstructions: ["T"],
      skillsDirective: "S",
      roster: "R",
      memoriesBlock: "MEM",
      goalDirective: "GOAL",
    });
    expect(out.systemPrompt).not.toContain("MEM");
    expect(out.systemPrompt).not.toContain("GOAL");
    expect(out.dynamicMessage).toContain("MEM");
    expect(out.dynamicMessage).toContain("GOAL");
  });

  it("is byte-identical across turns when only memories/goal change (cache stability)", () => {
    const base = { baseSystemPrompt: "BASE", isSubagent: false, trustedInstructions: ["T"], skillsDirective: "S", roster: "R" } as const;
    const turnA = assembleSystemPrompt({ ...base, goalDirective: "GOAL-A", memoriesBlock: "M1" });
    const turnB = assembleSystemPrompt({ ...base, goalDirective: "GOAL-B", memoriesBlock: "M2" });
    expect(turnA.systemPrompt).toBe(turnB.systemPrompt);
  });

  it("returns no systemPrompt override for subagents (keeps Pi base)", () => {
    const out = assembleSystemPrompt({ baseSystemPrompt: "BASE", isSubagent: true, trustedInstructions: [], skillsDirective: "", roster: "" });
    expect(out.systemPrompt).toBeUndefined();
  });
});
