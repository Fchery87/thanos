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

  it("still delivers an active goal directive for subagents (no systemPrompt, but a tail message)", () => {
    const out = assembleSystemPrompt({
      baseSystemPrompt: "BASE",
      isSubagent: true,
      trustedInstructions: [],
      skillsDirective: "",
      roster: "",
      goalDirective: "SUBAGENT-GOAL",
    });
    expect(out.systemPrompt).toBeUndefined();          // Pi base prompt preserved
    expect(out.dynamicMessage).toBe("SUBAGENT-GOAL");  // goal still delivered, not dropped
  });

  it("names the active permission mode in the static systemPrompt, not the dynamic tail", () => {
    const out = assembleSystemPrompt({
      baseSystemPrompt: "BASE",
      isSubagent: false,
      trustedInstructions: ["T"],
      skillsDirective: "S",
      roster: "R",
      permissionMode: "Permission mode: yolo — all permission prompts and policy checks are bypassed.",
      memoriesBlock: "MEM",
      goalDirective: "GOAL",
    });
    // Static section, not the dynamic tail — pinned so a later refactor
    // can't silently move it there and start busting the prompt cache.
    expect(out.systemPrompt).toContain("Permission mode: yolo");
    expect(out.dynamicMessage).not.toContain("Permission mode");
  });

  it("omits the permission block entirely when none is given (subagents pass none)", () => {
    const out = assembleSystemPrompt({
      baseSystemPrompt: "BASE",
      isSubagent: true,
      trustedInstructions: [],
      skillsDirective: "",
      roster: "",
      permissionMode: undefined,
    });
    expect(out.systemPrompt).toBeUndefined();
  });

  it("permissionMode participates in cache stability the same as the other static blocks", () => {
    const base = {
      baseSystemPrompt: "BASE",
      isSubagent: false,
      trustedInstructions: ["T"],
      skillsDirective: "S",
      roster: "R",
      permissionMode: "Permission mode: default — edits and commands require approval per policy.",
    } as const;
    const turnA = assembleSystemPrompt({ ...base, goalDirective: "GOAL-A", memoriesBlock: "M1" });
    const turnB = assembleSystemPrompt({ ...base, goalDirective: "GOAL-B", memoriesBlock: "M2" });
    expect(turnA.systemPrompt).toBe(turnB.systemPrompt);
    expect(turnA.systemPrompt).toContain("Permission mode: default");
  });
});
