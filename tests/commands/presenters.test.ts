import { describe, expect, it } from "vitest";
import {
  renderAuditPanel, renderPolicyPanel, renderSessionSnapshotPanel,
  renderSpecVerificationPanel, renderToolContractPanel,
} from "../../src/commands/presenters";
import { noopTheme } from "../../src/ui-utils";
import type { FormalSpec } from "../../src/spec/types";
import type { HarnessPolicy } from "../../src/policy/types";
import { buildToolContractSnapshot } from "../../src/governance/tool-contract";

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
  approvalStatus: "not_required",
  goal: "Build the billing flow",
  taskContract: {
    objective: "Build the billing flow",
    criteria: [{ id: "manual-primary", kind: "manual", statement: "Task completed", targets: [], evidence: ["manual"], expectedExecutables: [], expectedArgs: [], mustNot: [], source: "deterministic_fallback" }],
  },
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
      { criterion: spec.acceptanceCriteria[0], passed: true, evidence: ["manual ok"], missingEvidence: [] },
    ]);

    expect(presentation.panel).toContain("Active Spec");
    expect(presentation.panel).toContain("1/1 passed");
    expect(presentation.notification).toBe("info");
  });

  it("renders a goal-active variant without alarming failure framing", () => {
    const presentation = renderSpecVerificationPanel(noopTheme, spec, [
      { criterion: spec.acceptanceCriteria[0], passed: false, evidence: [], missingEvidence: ["manual"] },
    ], { goalActive: true });

    expect(presentation.panel).toContain("goal running");
    expect(presentation.panel).toContain("goal active");
    expect(presentation.notification).toBe("warning");
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

  it("renders the tool contract panel with policy disposition from the caller-supplied evaluator", () => {
    const snapshot = buildToolContractSnapshot({
      tools: [
        { name: "read", description: "Read a file", parameters: {} },
        { name: "bash", description: "Run a shell command", parameters: {} },
      ],
      activeToolNames: ["read"],
    });

    const panel = renderToolContractPanel(noopTheme, snapshot, (capability) =>
      capability === "exec" ? "ask" : "allow");

    expect(panel).toContain("Tool Registry");
    expect(panel).toContain("read");
    expect(panel).toContain("bash");
    expect(panel).toContain("(inactive)"); // bash was not in activeToolNames
    expect(panel).toContain("1 active");
  });

  it("reports no tools registered rather than an empty panel", () => {
    const snapshot = buildToolContractSnapshot({ tools: [], activeToolNames: [] });
    const panel = renderToolContractPanel(noopTheme, snapshot, () => "allow");
    expect(panel).toContain("No tools registered yet.");
  });
});
