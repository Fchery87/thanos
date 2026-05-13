// tests/agents/task-tool.test.ts
import { describe, it, expect } from "vitest";
import { Value } from "typebox/value";
import { TaskParamsSchema, extractFinalText, extractLatestAssistantText, buildSubagentEnv } from "../../src/agents/task-tool";

describe("TaskParamsSchema", () => {
  it("accepts valid explore args", () => {
    expect(Value.Check(TaskParamsSchema, { type: "explore", goal: "Find all usages of PermissionManager" })).toBe(true);
  });

  it("accepts omitting the type so the UI can select it", () => {
    expect(Value.Check(TaskParamsSchema, { goal: "Explain auth.ts" })).toBe(true);
  });

  it("rejects empty goal (caught by schema constraints)", () => {
    expect(Value.Check(TaskParamsSchema, { type: "explore", goal: "" })).toBe(false);
  });

  it("rejects invalid type", () => {
    expect(Value.Check(TaskParamsSchema, { type: "wizard", goal: "do something" })).toBe(false);
  });

  it("accepts optional context", () => {
    expect(Value.Check(TaskParamsSchema, { type: "plan", goal: "x", context: "foo" })).toBe(true);
  });
});

describe("extractFinalText", () => {
  it("extracts text from agent_end event", () => {
    const jsonl = [
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({
        type: "agent_end",
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          { role: "assistant", content: [{ type: "text", text: "Here is the answer." }] },
        ],
      }),
    ].join("\n");

    expect(extractFinalText(jsonl)).toBe("Here is the answer.");
  });

  it("returns fallback when no agent_end found", () => {
    expect(extractFinalText("not json")).toBe("(no output)");
  });
});

describe("extractLatestAssistantText", () => {
  it("extracts text from a message_end event", () => {
    const line = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "thinking..." }] },
    });
    expect(extractLatestAssistantText(line)).toBe("thinking...");
  });

  it("returns null for non-assistant or non-text events", () => {
    expect(extractLatestAssistantText(JSON.stringify({ type: "turn_start" }))).toBeNull();
    expect(extractLatestAssistantText("garbage")).toBeNull();
  });
});

describe("buildSubagentEnv", () => {
  const basePolicy = {
    version: 1 as const,
    preset: "team" as const,
    audit: { enabled: true },
    headless: { defaultDecision: "deny" as const },
    rules: [],
  };

  it("marks non-reviewer subagents as leaf agents (HARNESS_SUBAGENT=1)", () => {
    const env = buildSubagentEnv("explore", basePolicy, "/tmp/policy.json");
    expect(env.HARNESS_SUBAGENT).toBe("1");
    expect(env.HARNESS_POLICY_FILE).toBe("/tmp/policy.json");
  });

  it("marks reviewer subagents with their role so they can spawn explore agents", () => {
    const env = buildSubagentEnv("reviewer", basePolicy, "/tmp/policy.json");
    expect(env.HARNESS_SUBAGENT).toBe("reviewer");
    expect(env.HARNESS_POLICY_FILE).toBe("/tmp/policy.json");
  });

  it("marks build subagents as leaf agents", () => {
    const env = buildSubagentEnv("build", basePolicy, undefined);
    expect(env.HARNESS_SUBAGENT).toBe("1");
    expect(env.HARNESS_POLICY_FILE).toBeUndefined();
  });
});
