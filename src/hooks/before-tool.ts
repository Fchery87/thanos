// src/hooks/before-tool.ts
import { classifyRisk } from "../permissions/risk";
import type { AuditLogger } from "../audit/logger";
import { commandAuditTarget } from "../audit/target";
import type { PermissionManager } from "../permissions/manager";
import type { Capability } from "../permissions/rules";
import { formatPolicyDenial } from "../policy/denial";
import { evaluatePolicy } from "../policy/evaluator";
import type { HarnessPolicy } from "../policy/types";
import type { SpecEngine } from "../spec/engine";
import type { FormalSpec } from "../spec/types";

export interface BlockResult { block: true; reason: string; }
type PromptUser = (message: string) => Promise<boolean>;
type ApproveSpec = (spec: FormalSpec) => Promise<boolean>;

const TOOL_CAPABILITY: Record<string, Capability> = {
  read:  "read",
  ls:    "read",
  find:  "read",
  grep:  "read",
  write: "edit",
  edit:  "edit",
  bash:  "exec",
  task:  "task",
};

function extractTarget(toolName: string, input: Record<string, unknown>): string {
  const filePath = (input.file_path ?? input.path) as string | undefined;
  if (filePath) return filePath;
  if (input.command) return String(input.command);
  return toolName;
}

export function makeBeforeToolHandler(
  permissions: PermissionManager,
  spec: SpecEngine,
  promptUser: PromptUser,
  hasUI: boolean,
  approveSpec?: ApproveSpec,
  policy?: HarnessPolicy,
  auditLogger?: AuditLogger,
) {
  return async (event: { toolName: string; input: Record<string, unknown> }): Promise<BlockResult | undefined> => {
    const { toolName, input } = event;
    const tier = classifyRisk(toolName, input);
    const capability = TOOL_CAPABILITY[toolName] ?? "exec";
    const target = extractTarget(toolName, input);
    const policyDecision = policy ? evaluatePolicy(policy, capability, target) : null;

    const recordAudit = async (
      decision: "allow" | "deny" | "ask",
      ruleId?: string,
      pattern?: string,
    ) => {
      await auditLogger?.record({
        timestamp: new Date().toISOString(),
        sessionId: "unknown",
        agentType: "parent",
        toolName,
        capability,
        decision,
        ruleId,
        target:
          toolName === "bash"
            ? commandAuditTarget(target)
            : pattern
              ? { kind: "pattern", value: pattern }
              : { kind: "literal", value: target },
      });
    };

    // ── Yolo mode: skip all checks, allow everything ──────────────────
    if (permissions.isYolo) {
      await recordAudit("allow", "yolo");
      return;
    }


    if (policyDecision?.decision === "deny") {
      await recordAudit("deny", policyDecision.ruleId, policyDecision.pattern);
      return { block: true, reason: formatPolicyDenial(policyDecision) };
    }

    if (policyDecision?.decision === "ask") {
      await recordAudit("ask", policyDecision.ruleId, policyDecision.pattern);
    }

    // Low-risk: always allow
    if (tier === "low" && policyDecision?.decision !== "ask") {
      await recordAudit("allow", policyDecision?.ruleId, policyDecision?.pattern);
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
        await recordAudit(policy?.headless.defaultDecision ?? "deny");
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

    await recordAudit("allow", policyDecision?.ruleId, policyDecision?.pattern);
  };
}
