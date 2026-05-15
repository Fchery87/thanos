import { commandAuditTarget } from "../audit/target";
import type { AuditTarget } from "../audit/types";
import { classifyRisk, type RiskTier } from "../permissions/risk";
import type { Capability } from "../permissions/rules";
import { evaluatePolicy, type PolicyDecision } from "../policy/evaluator";
import type { HarnessPolicy } from "../policy/types";

export interface GovernedToolCall {
  toolName: string;
  input: Record<string, unknown>;
  capability: Capability;
  target: string;
  riskTier: RiskTier;
  commandFamily?: string;
  auditTarget: AuditTarget;
}

export interface GovernedToolDecision {
  call: GovernedToolCall;
  policyDecision: PolicyDecision | null;
  auditTarget: AuditTarget;
}

const TOOL_CAPABILITY: Record<string, Capability> = {
  read: "read",
  ls: "read",
  find: "read",
  grep: "read",
  write: "edit",
  edit: "edit",
  bash: "exec",
  task: "task",
};

export function capabilityForTool(toolName: string): Capability {
  return TOOL_CAPABILITY[toolName] ?? "exec";
}

export function targetForTool(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "bash" && typeof input.command === "string" && input.command.length > 0) {
    return input.command;
  }

  const filePath = input.file_path ?? input.path;
  if (typeof filePath === "string" && filePath.length > 0) return filePath;
  if (typeof input.command === "string" && input.command.length > 0) return input.command;
  return toolName;
}

function literalAuditTarget(value: string): AuditTarget {
  return { kind: "literal", value };
}

function policyAuditTarget(target: string, pattern: string | undefined): AuditTarget {
  if (pattern) return { kind: "pattern", value: pattern };
  return literalAuditTarget(target);
}

export function auditTargetForTool(toolName: string, target: string, pattern?: string): AuditTarget {
  if (pattern) return policyAuditTarget(target, pattern);
  return toolName === "bash" ? commandAuditTarget(target) : literalAuditTarget(target);
}

export function describeGovernedToolCall(
  toolName: string,
  input: Record<string, unknown>,
): GovernedToolCall {
  const capability = capabilityForTool(toolName);
  const target = targetForTool(toolName, input);
  const auditTarget = auditTargetForTool(toolName, target);
  return {
    toolName,
    input,
    capability,
    target,
    riskTier: classifyRisk(toolName, input),
    commandFamily: auditTarget.kind === "bash-command" ? auditTarget.family : undefined,
    auditTarget,
  };
}

export function evaluateGovernedToolCall(
  toolName: string,
  input: Record<string, unknown>,
  policy?: HarnessPolicy,
): GovernedToolDecision {
  const call = describeGovernedToolCall(toolName, input);
  const policyDecision = policy ? evaluatePolicy(policy, call.capability, call.target) : null;
  return {
    call,
    policyDecision,
    auditTarget: auditTargetForTool(toolName, call.target, policyDecision?.pattern),
  };
}
