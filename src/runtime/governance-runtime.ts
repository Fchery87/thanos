import type { AuditEvent } from "../audit/types";
import { evaluateEgress } from "../governance/egress";
import { evaluateGovernedToolCall, type GovernedToolDecision } from "../governance/tool-call";
import type { GovernedOperation, GovernedOperationResult } from "../governance/operation";
import { formatPolicyDenial } from "../policy/denial";
import type { HarnessPolicy } from "../policy/types";
import type { PermissionManager } from "../permissions/manager";
import type { DeliveryMode, DeliveryAutonomy } from "../governance/delivery";
import {
  roleNarrowingOverlay,
} from "../governance/role-overlay";
import {
  deliveryPolicyOverlay,
} from "../governance/delivery-overlay";
import { shouldBlockLocalOnlyPush } from "../governance/push-guard";

export interface GovernanceContext {
  policy: HarnessPolicy | undefined;
  permissions: PermissionManager;
  yolo: boolean;
  autonomy: DeliveryAutonomy;
  deliveryMode: DeliveryMode | undefined;
  childRole: string | undefined;
  hasUI: boolean;
  sessionId: string;
  agentType: "parent" | "subagent";
  recordAudit: (event: AuditEvent) => Promise<void>;
  promptUser: (message: string) => Promise<boolean>;
}

export interface GovernanceDecision {
  block: boolean;
  reason?: string;
  operation?: GovernedOperation;
  decision?: GovernedToolDecision;
  snapshotNeeded?: boolean;
}

function buildEffectivePolicy(
  basePolicy: HarnessPolicy,
  childRole: string | undefined,
  deliveryMode: DeliveryMode | undefined,
): HarnessPolicy {
  const roleOverlay = roleNarrowingOverlay(childRole);
  const deliveryOverlay = deliveryMode ? deliveryPolicyOverlay(deliveryMode) : [];
  const overlay = [...roleOverlay, ...deliveryOverlay];
  if (overlay.length === 0) return basePolicy;
  return { ...basePolicy, rules: [...overlay, ...basePolicy.rules] };
}

export class GovernanceRuntime {
  constructor(private ctx: GovernanceContext) {}

  async authorize(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<GovernanceDecision> {
    const { policy: basePolicy, deliveryMode, permissions, yolo } = this.ctx;

    // Egress check: runs before yolo — delivery denies are immutable
    if (deliveryMode === "local-only") {
      const egressDec = evaluateEgress(
        evaluateGovernedToolCall(toolName, input, basePolicy).call.egressClass,
        deliveryMode,
        false,
      );
      if (!egressDec.allowed) {
        await this.audit("deny", toolName, "exec", "egress:local-only");
        return { block: true, reason: egressDec.reason ?? "egress blocked" };
      }
    }

    // Argv-level push guard for local-only
    if (shouldBlockLocalOnlyPush(deliveryMode, toolName, input)) {
      return { block: true, reason: "local-only delivery mode forbids pushing to a remote" };
    }

    const effectivePolicy = basePolicy
      ? buildEffectivePolicy(basePolicy, this.ctx.childRole, deliveryMode)
      : undefined;

    const governed = evaluateGovernedToolCall(toolName, input, effectivePolicy);

    // Policy denial: blocks regardless of yolo
    if (governed.policyDecision?.decision === "deny") {
      await this.audit("deny", toolName, governed.call.capability, governed.policyDecision.ruleId);
      return { block: true, reason: formatPolicyDenial(governed.policyDecision) };
    }

    // Yolo: skip all remaining checks
    if (yolo) {
      await this.audit("allow", toolName, governed.call.capability, "yolo");
      return { block: false, operation: this.toOperation(governed) };
    }

    // Low-risk: always allow unless policy says ask
    if (governed.call.riskTier === "low" && governed.policyDecision?.decision !== "ask") {
      await this.audit("allow", toolName, governed.call.capability, governed.policyDecision?.ruleId);
      return { block: false, operation: this.toOperation(governed), snapshotNeeded: false };
    }

    // Explicit policy allow for unrecognized tools (MCP escape hatch)
    if (!governed.call.recognized && governed.policyDecision?.decision === "allow") {
      await this.audit("allow", toolName, governed.call.capability, governed.policyDecision.ruleId);
      return { block: false, operation: this.toOperation(governed) };
    }

    // Permission evaluation
    const permDecision = permissions.evaluate(governed.call.capability, governed.call.target);
    if (permDecision === "deny") {
      await this.audit("deny", toolName, governed.call.capability);
      return { block: true, reason: `${toolName} denied (capability: ${governed.call.capability})` };
    }

    // Unattended autonomy: auto-allow known tools within the ceiling
    if (this.ctx.autonomy === "unattended" && governed.call.recognized) {
      await this.audit("allow", toolName, governed.call.capability, "autonomy:unattended");
      return { block: false, operation: this.toOperation(governed) };
    }

    // Interactive confirmation for high/critical
    if (permDecision === "ask" || governed.call.riskTier === "high" || governed.call.riskTier === "critical") {
      if (!this.ctx.hasUI) {
        await this.audit("deny", toolName, governed.call.capability);
        return { block: true, reason: `${toolName} requires confirmation but no UI available` };
      }
      const label = governed.call.riskTier === "critical" ? "CRITICAL" : "HIGH RISK";
      const allowed = await this.ctx.promptUser(`${label}: Allow ${toolName} on "${governed.call.target}"?`);
      if (!allowed) {
        await this.audit("deny", toolName, governed.call.capability);
        return { block: true, reason: `User denied ${toolName}` };
      }
      permissions.remember(governed.call.capability, governed.call.target, "allow");
      await this.audit("allow", toolName, governed.call.capability);
      return { block: false, operation: this.toOperation(governed), snapshotNeeded: governed.call.riskTier === "critical" };
    }

    await this.audit("allow", toolName, governed.call.capability, governed.policyDecision?.ruleId);
    return { block: false, operation: this.toOperation(governed) };
  }

  async record(_result: GovernedOperationResult): Promise<void> {
    // Evidence collection and audit are handled by callers (after-tool hook)
  }

  private toOperation(governed: GovernedToolDecision): GovernedOperation {
    const { call } = governed;
    return {
      kind: "tool",
      principal: { kind: "parent", id: this.ctx.sessionId },
      capability: call.capability,
      target: call.target,
      riskTier: call.riskTier,
      egressClass: call.egressClass,
      auditTarget: call.auditTarget,
      recognized: call.recognized,
      toolName: call.toolName,
      input: call.input,
    };
  }

  private async audit(
    decision: "allow" | "deny" | "ask",
    toolName: string,
    capability: string,
    ruleId?: string,
  ): Promise<void> {
    await this.ctx.recordAudit({
      timestamp: new Date().toISOString(),
      sessionId: this.ctx.sessionId,
      agentType: this.ctx.agentType,
      toolName,
      capability,
      decision,
      ruleId,
      target: { kind: "literal", value: toolName },
    });
  }
}
