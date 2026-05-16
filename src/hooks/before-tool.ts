// src/hooks/before-tool.ts
import type { AuditLogger } from "../audit/logger";
import type { PermissionManager } from "../permissions/manager";
import { formatPolicyDenial } from "../policy/denial";
import type { HarnessPolicy } from "../policy/types";
import type { SpecEngine } from "../spec/engine";
import type { FormalSpec } from "../spec/types";
import { evaluateGovernedToolCall } from "../governance/tool-call";

export interface BlockResult { block: true; reason: string; }
type PromptUser = (message: string) => Promise<boolean>;
type ApproveSpec = (spec: FormalSpec) => Promise<boolean>;

export interface AuditContext {
  sessionId: string;
  agentType: "parent" | "subagent";
}

export function makeBeforeToolHandler(
  permissions: PermissionManager,
  spec: SpecEngine,
  promptUser: PromptUser,
  hasUI: boolean,
  approveSpec?: ApproveSpec,
  policy?: HarnessPolicy,
  auditLogger?: AuditLogger,
  auditContext?: AuditContext,
) {
  return async (event: { toolName: string; input: Record<string, unknown> }): Promise<BlockResult | undefined> => {
    const { toolName, input } = event;
    const governed = evaluateGovernedToolCall(toolName, input, policy);
    const { call, policyDecision, auditTarget } = governed;
    const { capability, target, riskTier: tier } = call;

    const recordAudit = async (
      decision: "allow" | "deny" | "ask",
      ruleId?: string,
    ) => {
      await auditLogger?.record({
        timestamp: new Date().toISOString(),
        sessionId: auditContext?.sessionId ?? "unknown",
        agentType: auditContext?.agentType ?? "parent",
        toolName,
        capability,
        decision,
        ruleId,
        target: auditTarget,
      });
    };

    // ── Yolo mode: skip all checks, allow everything ──────────────────
    if (permissions.isYolo) {
      await recordAudit("allow", "yolo");
      return;
    }

    if (policyDecision?.decision === "deny") {
      await recordAudit("deny", policyDecision.ruleId);
      return { block: true, reason: formatPolicyDenial(policyDecision) };
    }

    if (policyDecision?.decision === "ask") {
      await recordAudit("ask", policyDecision.ruleId);
    }

    // Low-risk: always allow
    if (tier === "low" && policyDecision?.decision !== "ask") {
      await recordAudit("allow", policyDecision?.ruleId);
      return;
    }

    // Explicit-spec approval gate (fires before normal permission flow)
    const active = spec.activeSpec;
    if (active?.approvalStatus === "pending") {
      if (!hasUI || !approveSpec) {
        return { block: true, reason: "Explicit spec needs approval but no UI available" };
      }
      const approved = await approveSpec(active);
      if (approved) {
        active.approvalStatus = "approved";
      } else {
        active.approvalStatus = "rejected";
        permissions.remember("*", "*", "deny");
        await recordAudit("deny", "spec-rejected");
        return { block: true, reason: `User rejected spec: ${active.goal}` };
      }
    }

    if (active?.tier === "explicit" && !active.allowedCapabilities.includes(capability)) {
      return {
        block: true,
        reason: `Blocked by explicit spec scope: ${capability} is not allowed for this task`,
      };
    }

    const decision = permissions.evaluate(capability, target);

    if (decision === "deny") {
      await recordAudit("deny");
      return { block: true, reason: `${toolName} denied (capability: ${capability})` };
    }

    if (decision === "ask" || tier === "high" || tier === "critical") {
      if (!hasUI) {
        await recordAudit("deny");
        return { block: true, reason: `${toolName} requires confirmation but no UI available` };
      }
      const label = tier === "critical" ? "⚠ CRITICAL" : "⚠ HIGH RISK";
      const allowed = await promptUser(`${label}: Allow ${toolName} on "${target}"?`);
      if (!allowed) {
        await recordAudit("deny");
        return { block: true, reason: `User denied ${toolName} on "${target}"` };
      }
      permissions.remember(capability, target, "allow");
      await recordAudit("allow");
      return;
    }

    await recordAudit("allow", policyDecision?.ruleId);
  };
}
