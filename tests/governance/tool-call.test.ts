import { describe, expect, it } from "vitest";
import { describeGovernedToolCall, evaluateGovernedToolCall } from "../../src/governance/tool-call";
import type { HarnessPolicy } from "../../src/policy/types";

describe("describeGovernedToolCall", () => {
  it("normalizes read-like tools", () => {
    const call = describeGovernedToolCall("read", { path: "src/index.ts" });
    expect(call.capability).toBe("read");
    expect(call.target).toBe("src/index.ts");
    expect(call.riskTier).toBe("low");
    expect(call.auditTarget).toEqual({ kind: "literal", value: "src/index.ts" });
  });

  it("uses bash command family metadata for shell calls", () => {
    const call = describeGovernedToolCall("bash", { command: "rm -rf tmp" });
    expect(call.capability).toBe("exec");
    expect(call.target).toBe("rm -rf tmp");
    expect(call.riskTier).toBe("critical");
    expect(call.commandFamily).toBe("destructive");
    expect(call.auditTarget).toEqual({ kind: "bash-command", value: "rm -rf tmp", family: "destructive" });
  });

  it("defaults unknown tools to exec", () => {
    const call = describeGovernedToolCall("mystery", { command: "echo hi" });
    expect(call.capability).toBe("exec");
    expect(call.target).toBe("echo hi");
  });
});

describe("evaluateGovernedToolCall", () => {
  it("returns policy metadata and pattern audit targets", () => {
    const policy = {
      version: 1,
      preset: "team",
      rules: [
        {
          id: "deny-env",
          capability: "read",
          pattern: ".env*",
          decision: "deny",
          reason: "secret env file",
        },
      ],
      audit: { enabled: true },
      headless: { defaultDecision: "deny" },
    } satisfies HarnessPolicy;

    const result = evaluateGovernedToolCall("read", { file_path: ".env.local" }, policy);

    expect(result.policyDecision).toEqual({ decision: "deny", ruleId: "deny-env", pattern: ".env*" });
    expect(result.auditTarget).toEqual({ kind: "pattern", value: ".env*" });
  });
});
