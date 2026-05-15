import { describe, expect, it } from "vitest";
import { renderAuditPanel, renderPolicyPanel, renderSessionSnapshotPanel, renderSpecVerificationPanel } from "../../src/commands/presenters";
import { noopTheme } from "../../src/ui-utils";
import type { FormalSpec } from "../../src/spec/types";
import type { HarnessPolicy } from "../../src/policy/types";

const policy = {
  version: 1,
  preset: "team",
  rules: [
    { id: "allow-read", capability: "read", decision: "allow", reason: "ok" },
  ],
  audit: { enabled: true, path: ".harness/audit.jsonl" },
  headless: { defaultDecision: "deny" },
} satisfies HarnessPolicy;

const spec = {
  id: "spec-1",
  tier: "ambient",
  status: "active",
  approvalStatus: "not_required",
  goal: "Build the billing flow",
  allowedCapabilities: ["read", "edit"],
  constraints: ["Keep data safe"],
  acceptanceCriteria: [
    { id: "crit-1", statement: "Task completed", evidenceRequired: ["manual"] },
  ],
  targetFiles: [],
  risks: ["May require data migration"],
  createdAt: 1,
} satisfies FormalSpec;

describe("command presenters", () => {
  it("renders the session snapshot panel", () => {
    const panel = renderSessionSnapshotPanel(noopTheme, {
      modelStr: "gpt-4",
      thinkingStr: "low",
      modeStr: "explore",
      spec,
      contextStr: "5 tokens",
      policy,
      yolo: false,
    });

    expect(panel).toContain("Session Snapshot");
    expect(panel).toContain("Model:");
    expect(panel).toContain("Policy:");
  });

  it("renders the spec verification panel", () => {
    const presentation = renderSpecVerificationPanel(noopTheme, spec, [
      { criterion: spec.acceptanceCriteria[0], passed: true, evidence: ["manual ok"] },
    ]);

    expect(presentation.panel).toContain("Active Spec");
    expect(presentation.panel).toContain("1/1 passed");
    expect(presentation.notification).toBe("info");
  });

  it("renders the policy panel", () => {
    const panel = renderPolicyPanel(noopTheme, policy);

    expect(panel).toContain("Active Policy");
    expect(panel).toContain("allow-read");
  });

  it("renders the audit panel", () => {
    const panel = renderAuditPanel(noopTheme, [
      {
        timestamp: "2026-05-14T12:00:00.000Z",
        sessionId: "s1",
        agentType: "parent",
        toolName: "read",
        capability: "read",
        decision: "allow",
        target: { kind: "literal", value: "src/index.ts" },
      },
    ]);

    expect(panel).toContain("Audit Log (1)");
    expect(panel).toContain("src/index.ts");
  });
});
