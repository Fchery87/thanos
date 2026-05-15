import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSubagentEnv,
  extractFinalText,
  extractLatestAssistantText,
  getPiInvocation,
  resolveFinalText,
} from "../../src/agents/execution";

describe("getPiInvocation", () => {
  it("relaunches an existing script with the current node executable", () => {
    const originalArgv1 = process.argv[1];
    const scriptFile = "/tmp/harness-entry.ts";
    fs.writeFileSync(scriptFile, "");
    process.argv[1] = scriptFile;

    const result = getPiInvocation(["--mode", "json"]);

    expect(result).toEqual({ cmd: process.execPath, args: [scriptFile, "--mode", "json"] });

    process.argv[1] = originalArgv1;
    fs.rmSync(scriptFile, { force: true });
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

describe("assistant text extraction", () => {
  it("extracts assistant text from message_end events and ignores malformed JSON", () => {
    expect(extractLatestAssistantText("not json")).toBeNull();
    expect(
      extractLatestAssistantText(
        JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "thinking..." }] },
        }),
      ),
    ).toBe("thinking...");
  });

  it("extracts the final assistant text from agent_end output and skips malformed lines", () => {
    const stdout = [
      "not json",
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({
        type: "agent_end",
        messages: [
          { role: "user", content: [{ type: "text", text: "ignored" }] },
          { role: "assistant", content: [{ type: "text", text: "Here is the answer." }] },
        ],
      }),
    ].join("\n");

    expect(extractFinalText(stdout)).toBe("Here is the answer.");
  });
});

describe("timeout output", () => {
  it("formats timeout output for unresolved subprocesses", () => {
    expect(
      resolveFinalText({ stdout: "", code: null, timedOut: true, timeoutMs: 5 }),
    ).toBe("(subagent timed out after 5ms)");
  });
});
