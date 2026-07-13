// src/hooks/before-tool.ts
import type { AuditLogger } from "../audit/logger";
import type { PermissionManager } from "../permissions/manager";
import { formatPolicyDenial } from "../policy/denial";
import type { HarnessPolicy } from "../policy/types";
import type { SpecEngine } from "../spec/engine";
import type { FormalSpec } from "../spec/types";
import { evaluateGovernedToolCall, type GovernedToolDecision } from "../governance/tool-call";

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
  autonomy: "attended" | "unattended" = "attended",
) {
  return async (
    event: { toolName: string; input: Record<string, unknown> },
    precomputed?: GovernedToolDecision,
  ): Promise<BlockResult | undefined> => {
    const { toolName, input } = event;
    const governed = precomputed ?? evaluateGovernedToolCall(toolName, input, policy);
    const { call, policyDecision, auditTarget } = governed;
    const { capability, target, riskTier: tier, recognized } = call;

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

    // An explicit policy allow rule for an unrecognized tool (most commonly an
    // MCP server's) is the deliberately-authored escape hatch that keeps a
    // specifically-vetted integration from re-prompting on every call, in any
    // autonomy mode. Scoped to unrecognized tools only: a known tool (edit,
    // bash, …) keeps its existing prompt-then-remember behavior even under a
    // broad policy allow rule — this is not a general "policy allow skips
    // every prompt" feature, only the unknown-tool trust escape hatch.
    if (!recognized && policyDecision?.decision === "allow") {
      await recordAudit("allow", policyDecision.ruleId);
      return;
    }

    // Unattended autonomy: trust the policy ceiling — skip the interactive
    // confirmation for actions already permitted by the default ceiling. All
    // deny paths (policy deny, permission deny, explicit-spec scope) were
    // enforced above and still block; this only replaces the human prompt
    // with an automatic allow. Restricted to recognized tools: an
    // unrecognized tool (most commonly an MCP server's) has no default
    // ceiling to trust — only an explicit policy allow (handled above) earns
    // it a pass; otherwise it falls through to the confirm/deny path below,
    // which denies under the common unattended (headless) shape.
    if (autonomy === "unattended" && recognized) {
      await recordAudit("allow", "autonomy:unattended");
      return;
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
