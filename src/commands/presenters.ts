import type { AuditEvent } from "../audit/types";
import type { HarnessPolicy } from "../policy/types";
import type { FormalSpec } from "../spec/types";
import type { VerificationResult } from "../spec/verification";
import type { TUITheme } from "../ui-utils";
import { formatBadge, formatLabel, formatPanel, formatValue } from "../ui-utils";

export function renderSessionSnapshotPanel(
  theme: TUITheme,
  args: {
    modelStr: string;
    thinkingStr: string;
    modeStr: string;
    spec: FormalSpec | undefined;
    contextStr: string;
    policy: HarnessPolicy;
    yolo: boolean;
  },
): string {
  const specStr = args.spec
    ? `${formatValue(theme, args.spec.tier, "accent")} ${theme.fg("dim", "—")} "${args.spec.goal.length > 60 ? `${args.spec.goal.slice(0, 57)}…` : args.spec.goal}"`
    : theme.fg("dim", "none");

  const policyStr = `${formatValue(theme, args.policy.preset, "accent")}  ${theme.fg("dim", "—")}  ${args.policy.rules.length} rules  ${theme.fg("dim", "—")}  audit ${args.policy.audit.enabled ? theme.fg("success", "on") : theme.fg("dim", "off")}`;

  const lines = [
    `${formatLabel(theme, "Model:", 10)} ${formatValue(theme, args.modelStr, "accent")}`,
    `${formatLabel(theme, "Thinking:", 10)} ${formatValue(theme, args.thinkingStr, "accent")}`,
    `${formatLabel(theme, "Mode:", 10)} ${formatValue(theme, args.modeStr, "accent")}`,
    `${formatLabel(theme, "Spec:", 10)} ${specStr}`,
    `${formatLabel(theme, "Context:", 10)} ${args.contextStr}`,
    `${formatLabel(theme, "Policy:", 10)} ${policyStr}`,
    `${formatLabel(theme, "Yolo:", 10)} ${args.yolo ? theme.fg("warning", "⚡ ON — all checks bypassed") : theme.fg("dim", "off")}`,
  ];

  return formatPanel(theme, "Session Snapshot", lines, args.yolo ? "warning" : "dim");
}

export function renderSpecVerificationPanel(
  theme: TUITheme,
  active: FormalSpec,
  results: VerificationResult[],
): { panel: string; notification: "info" | "warning" } {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const criteriaLines = results.map((r) =>
    `  ${r.passed ? theme.fg("success", "✓") : theme.fg("dim", "·")} ${theme.fg("muted", `[${r.criterion.id}]`)}  ${r.criterion.statement}`,
  );
  const statusColor = passed === total && total > 0 ? "success" : "warning";
  const lines = [
    `${formatLabel(theme, "Spec ID:", 10)}  ${theme.fg("dim", active.id)}`,
    `${formatLabel(theme, "Tier:", 10)}  ${formatValue(theme, active.tier, "accent")}  ${theme.fg("dim", `[${active.approvalStatus}]`)}`,
    `${formatLabel(theme, "Goal:", 10)}  ${active.goal}`,
    `${formatLabel(theme, "Criteria:", 10)}  ${theme.fg(statusColor, `${passed}/${total}`)} passed`,
    ...criteriaLines,
  ];

  if (active.constraints.length > 0) {
    lines.push(`${formatLabel(theme, "Constraints:", 12)} ${active.constraints.map((c) => theme.fg("accent", c)).join(", ")}`);
  }
  if (active.risks.length > 0) {
    lines.push(`${formatLabel(theme, "Risks:", 12)} ${active.risks.map((r) => theme.fg("error", r)).join(", ")}`);
  }

  return {
    panel: formatPanel(theme, "Active Spec", lines, statusColor),
    notification: total > 0 && passed === total ? "info" : "warning",
  };
}

export function renderPolicyPanel(theme: TUITheme, policy: HarnessPolicy): string {
  const count = (decision: string) => policy.rules.filter((rule) => rule.decision === decision).length;
  const auditStr = policy.audit.enabled
    ? `${theme.fg("success", "on")}  ${theme.fg("dim", "→")}  ${theme.fg("accent", policy.audit.path ?? ".harness/audit.jsonl")}`
    : theme.fg("dim", "off");

  const lines = [
    `${formatLabel(theme, "Preset:", 10)} ${formatValue(theme, policy.preset, "accent")}`,
    `${formatLabel(theme, "Rules:", 10)} ${policy.rules.length} total  ${theme.fg("dim", "(")}${theme.fg("success", String(count("allow")))} allow / ${theme.fg("warning", String(count("ask")))} ask / ${theme.fg("error", String(count("deny")))} deny${theme.fg("dim", ")")}`,
    `${formatLabel(theme, "Audit:", 10)} ${auditStr}`,
    `${formatLabel(theme, "Headless:", 10)} ${formatValue(theme, policy.headless.defaultDecision, "accent")} by default`,
  ];

  if (policy.rules.length > 0) {
    lines.push("", theme.bold("Rules:"));
    for (const rule of policy.rules) {
      const target = rule.pattern
        ? `${rule.capability}:${rule.pattern}`
        : rule.commandFamily
          ? `${rule.capability}[${rule.commandFamily}]`
          : rule.capability;
      lines.push(`  ${formatBadge(theme, rule.decision)} ${theme.fg("dim", rule.id.padEnd(20, " "))} ${theme.fg("accent", target)}`);
    }
  }

  return formatPanel(theme, "Active Policy", lines, "dim");
}

export function renderAuditPanel(theme: TUITheme, entries: AuditEvent[]): string {
  const rows = entries.map((entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const decisionFormatted = entry.decision === "allow"
      ? theme.fg("success", entry.decision)
      : entry.decision === "deny"
        ? theme.fg("error", entry.decision)
        : theme.fg("warning", entry.decision);
    return `  ${formatBadge(theme, entry.decision)} ${theme.fg("dim", `[${time}]`)}  ${theme.fg("accent", entry.toolName.padEnd(8, " "))} ${theme.fg("dim", "→")}  ${entry.target.value}  ${theme.fg("dim", "[")}${decisionFormatted}${theme.fg("dim", "]")}`;
  });

  return formatPanel(theme, `Audit Log (${entries.length})`, rows, "dim");
}
