import type { HarnessPolicy, PolicyPreset, PolicyRule } from "./types";
import { getPresetPolicy } from "./presets";

const VALID_PRESETS: PolicyPreset[] = ["personal", "team", "ci"];
const VALID_DECISIONS = ["allow", "ask", "deny"] as const;
const VALID_CAPABILITIES = ["read", "edit", "exec", "task", "interaction"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPreset(value: unknown): value is PolicyPreset {
  return typeof value === "string" && VALID_PRESETS.includes(value as PolicyPreset);
}

function isDecision(value: unknown): value is PolicyRule["decision"] {
  return typeof value === "string" && (VALID_DECISIONS as readonly string[]).includes(value);
}

function isCapability(value: unknown): value is PolicyRule["capability"] {
  return value === "*" || (typeof value === "string" && (VALID_CAPABILITIES as readonly string[]).includes(value));
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function parseRule(value: unknown, index: number): PolicyRule {
  if (!isRecord(value)) throw new Error(`Policy rule ${index + 1} must be an object`);

  const id = optionalString(value.id, `Policy rule ${index + 1} id`);
  if (!id) throw new Error(`Policy rule ${index + 1} id is required`);

  if (!isCapability(value.capability)) throw new Error(`Policy rule ${id} capability is invalid`);
  if (!isDecision(value.decision)) throw new Error(`Policy rule ${id} decision is invalid`);

  const reason = optionalString(value.reason, `Policy rule ${id} reason`);
  if (!reason) throw new Error(`Policy rule ${id} reason is required`);

  const pattern = optionalString(value.pattern, `Policy rule ${id} pattern`);
  const commandFamily = optionalString(value.commandFamily, `Policy rule ${id} commandFamily`);

  return {
    id,
    capability: value.capability,
    ...(pattern ? { pattern } : {}),
    ...(commandFamily ? { commandFamily } : {}),
    decision: value.decision,
    reason,
  };
}

function parseAudit(value: unknown, fallback: HarnessPolicy["audit"]): HarnessPolicy["audit"] {
  if (!isRecord(value)) return fallback;

  const enabled = value.enabled === undefined
    ? fallback.enabled
    : optionalBoolean(value.enabled, "Policy audit.enabled");
  const path = optionalString(value.path, "Policy audit.path");

  return {
    enabled: enabled ?? fallback.enabled,
    ...(path ? { path } : {}),
  };
}

function parseHeadless(value: unknown, fallback: HarnessPolicy["headless"]): HarnessPolicy["headless"] {
  if (!isRecord(value)) return fallback;

  const defaultDecision = value.defaultDecision === undefined
    ? fallback.defaultDecision
    : value.defaultDecision;
  if (!isDecision(defaultDecision)) {
    throw new Error("Policy headless.defaultDecision is invalid");
  }

  return { defaultDecision };
}

function assertUniqueRuleIds(rules: PolicyRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new Error(`Policy rule id must be unique: ${rule.id}`);
    seen.add(rule.id);
  }
}

export function parsePolicy(value: unknown): HarnessPolicy {
  if (!isRecord(value)) throw new Error("Policy must be an object");
  if (value.version !== 1) throw new Error("Policy version must be 1");
  if (!isPreset(value.preset)) throw new Error("Policy preset is invalid");
  if (!Array.isArray(value.rules)) throw new Error("Policy rules must be an array");

  const base = getPresetPolicy(value.preset);
  const customRules = value.rules.map((rule, index) => parseRule(rule, index));
  const rules = [...customRules, ...base.rules];
  assertUniqueRuleIds(rules);

  return {
    version: 1,
    preset: value.preset,
    rules,
    audit: parseAudit(value.audit, base.audit),
    headless: parseHeadless(value.headless, base.headless),
  };
}
