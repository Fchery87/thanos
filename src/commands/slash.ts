import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AuditEvent } from "../audit/types";
import type { PermissionManager } from "../permissions/manager";
import type { HarnessPolicy } from "../policy/types";
import type { SpecEngine } from "../spec/engine";
import type { TaskParams } from "../agents/task-tool";
import { formatBadge, formatLabel, formatValue, formatPanel } from "../ui-utils";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// Maps tool names to the capability the policy engine evaluates them under.
const TOOL_CAPABILITY: Record<string, "read" | "edit" | "exec" | "task"> = {
  read:  "read",
  ls:    "read",
  find:  "read",
  grep:  "read",
  write: "edit",
  edit:  "edit",
  bash:  "exec",
  task:  "task",
};

function fmtN(n: number): string {
  return n.toLocaleString();
}

export function registerSlashCommands(
  pi: ExtensionAPI,
  opts: {
    permissions: PermissionManager;
    spec: SpecEngine;
    policyPromise: Promise<HarnessPolicy>;
    getDefaultTaskType: () => TaskParams["type"] | undefined;
  },
): void {
  const { permissions, spec, policyPromise, getDefaultTaskType } = opts;

  // ── /skills ───────────────────────────────────────────────────────────────
  // Browse all loaded skills in one place.
  pi.registerCommand("skills", {
    description: "List all loaded skills with their descriptions.",
    handler: async (_args, ctx) => {
      const theme = ctx.ui.theme;
      const allCommands = pi.getCommands();
      const skills = allCommands.filter(c => c.source === "skill");

      if (skills.length === 0) {
        ctx.ui.notify(formatPanel(theme, "Skills", theme.fg("dim", "No skills loaded."), "dim"), "info");
        return;
      }

      const lines = skills.map(s =>
        `  ${theme.fg("accent", ("/" + s.name).padEnd(24, " "))} ${theme.fg("dim", s.description ?? "")}`,
      );
      ctx.ui.notify(formatPanel(theme, `Skills (${skills.length})`, lines, "dim"), "info");
    },
  });

  // ── /context ──────────────────────────────────────────────────────────────
  // You can't manage what you can't measure.
  pi.registerCommand("context", {
    description: "Show token count and window fill % for the active model.",
    handler: async (_args, ctx) => {
      const usage = ctx.getContextUsage();
      const theme = ctx.ui.theme;
      if (!usage) {
        ctx.ui.notify("No context data yet. Send a message first.", "warning");
        return;
      }
      const { tokens, contextWindow, percent } = usage;
      const tokStr = tokens !== null ? fmtN(tokens) : "unknown";
      const pctRaw = percent !== null ? Math.round(percent * 100) : null;
      const pctStr = pctRaw !== null ? `${pctRaw}%` : "?%";
      const windowK = Math.round(contextWindow / 1000);
      const warn = pctRaw !== null && pctRaw > 80;
      const hint = warn ? `\n${theme.fg("warning", "You're above 80%. Run /compact before the window fills.")}` : "";

      const content = `${formatLabel(theme, "Context:", 10)} ${formatValue(theme, tokStr, "accent")} tokens ${theme.fg("dim", "—")} ${warn ? theme.fg("warning", pctStr) : theme.fg("success", pctStr)} of ${windowK}k window${hint}`;
      const panel = formatPanel(theme, "Context Window", content, warn ? "warning" : "dim");
      ctx.ui.notify(panel, warn ? "warning" : "info");
    },
  });

  // ── /policy ───────────────────────────────────────────────────────────────
  // What the agent is allowed to do — and what it isn't.
  pi.registerCommand("policy", {
    description: "Show active policy: preset, rule counts, audit status, and headless default.",
    handler: async (_args, ctx) => {
      const policy = await policyPromise;
      const theme = ctx.ui.theme;
      const count = (d: string) => policy.rules.filter(r => r.decision === d).length;
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

      const panel = formatPanel(theme, "Active Policy", lines, "dim");
      ctx.ui.notify(panel, "info");
    },
  });

  // ── /tools ────────────────────────────────────────────────────────────────
  // What the agent sees — and what the policy says about each one.
  pi.registerCommand("tools", {
    description: "List active tools with their policy disposition: allow, ask, or deny.",
    handler: async (_args, ctx) => {
      const activeNames = new Set(pi.getActiveTools());
      const allTools = pi.getAllTools();
      const theme = ctx.ui.theme;

      if (allTools.length === 0) {
        ctx.ui.notify("No tools registered yet.", "warning");
        return;
      }

      const lines = allTools.map(tool => {
        const cap = TOOL_CAPABILITY[tool.name] ?? "exec";
        const decision = permissions.evaluate(cap, tool.name);
        const activeLabel = activeNames.has(tool.name) ? "" : theme.fg("dim", " (inactive)");
        const toolNameFormatted = activeNames.has(tool.name) ? theme.fg("accent", tool.name.padEnd(12, " ")) : theme.fg("dim", tool.name.padEnd(12, " "));
        const decisionFormatted = decision === "allow" ? theme.fg("success", decision) : decision === "deny" ? theme.fg("error", decision) : theme.fg("warning", decision);
        return `  ${formatBadge(theme, decision)} ${toolNameFormatted} ${theme.fg("dim", "[")}${decisionFormatted}${theme.fg("dim", "]")}${activeLabel}`;
      });

      const header = `${theme.bold("Tools")}  ${theme.fg("dim", "(")}${theme.fg("success", "✓")} allow  ${theme.fg("warning", "?")} ask  ${theme.fg("error", "✗")} deny${theme.fg("dim", ")")}:`;
      const panel = formatPanel(theme, "Tool Registry", [header, ...lines], "dim");
      ctx.ui.notify(panel, "info");
    },
  });

  // ── /spec ─────────────────────────────────────────────────────────────────
  // What the agent agreed to do this turn — and whether it's done it.
  pi.registerCommand("spec", {
    description: "Show the current spec: goal, tier, criteria, and verification state.",
    handler: async (_args, ctx) => {
      const active = spec.activeSpec;
      const theme = ctx.ui.theme;
      if (!active) {
        ctx.ui.notify(
          "No active spec.\nSpecs generate on ambient and explicit tasks — not instant reads.",
          "info",
        );
        return;
      }

      const results = spec.verify();
      const passed = results.filter(r => r.passed).length;
      const total = results.length;

      const criteriaLines = results.map(r =>
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
        lines.push(`${formatLabel(theme, "Constraints:", 12)} ${active.constraints.map(c => theme.fg("accent", c)).join(", ")}`);
      }
      if (active.risks.length > 0) {
        lines.push(`${formatLabel(theme, "Risks:", 12)} ${active.risks.map(r => theme.fg("error", r)).join(", ")}`);
      }

      const panel = formatPanel(theme, "Active Spec", lines, statusColor);
      ctx.ui.notify(panel, total > 0 && passed === total ? "info" : "warning");
    },
  });

  // ── /audit ────────────────────────────────────────────────────────────────
  // The truth about what happened — tool by tool.
  pi.registerCommand("audit", {
    description: "Show the last N audit log entries. Defaults to 10.",
    getArgumentCompletions: (prefix) => {
      const opts = ["5", "10", "20", "50"];
      const filtered = opts.filter(o => o.startsWith(prefix));
      return filtered.length > 0 ? filtered.map(value => ({ value, label: `last ${value}` })) : null;
    },
    handler: async (args, ctx) => {
      const policy = await policyPromise;
      const theme = ctx.ui.theme;

      if (!policy.audit.enabled) {
        ctx.ui.notify(
          "Audit logging is off for this policy preset.\nSet audit.enabled = true in harness.policy.json to enable it.",
          "warning",
        );
        return;
      }

      const auditPath = policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl");
      const n = Math.max(1, parseInt(args.trim() || "10", 10) || 10);

      let raw: string;
      try {
        raw = await readFile(auditPath, "utf-8");
      } catch {
        ctx.ui.notify(
          "No audit log yet.\nIt gets written on the first governed tool call.",
          "info",
        );
        return;
      }

      const entries = raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-n)
        .map(line => {
          try { return JSON.parse(line) as AuditEvent; } catch { return null; }
        })
        .filter((e): e is AuditEvent => e !== null);

      if (entries.length === 0) {
        ctx.ui.notify("Audit log is empty.", "info");
        return;
      }

      const rows = entries.map(e => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        const decisionFormatted = e.decision === "allow" ? theme.fg("success", e.decision) : e.decision === "deny" ? theme.fg("error", e.decision) : theme.fg("warning", e.decision);
        return `  ${formatBadge(theme, e.decision)} ${theme.fg("dim", `[${time}]`)}  ${theme.fg("accent", e.toolName.padEnd(8, " "))} ${theme.fg("dim", "→")}  ${e.target.value}  ${theme.fg("dim", "[")}${decisionFormatted}${theme.fg("dim", "]")}`;
      });

      const panel = formatPanel(theme, `Audit Log (${entries.length})`, rows, "dim");
      ctx.ui.notify(panel, "info");
    },
  });

  // ── /rename ───────────────────────────────────────────────────────────────
  // Sessions are easier to find when they're named.
  pi.registerCommand("rename", {
    description: "Rename the current session.",
    handler: async (args, ctx) => {
      const name = args.trim();
      const theme = ctx.ui.theme;
      if (!name) {
        ctx.ui.notify("Pass a name: /rename <session-name>", "warning");
        return;
      }
      await pi.setSessionName(name);
      ctx.ui.notify(formatPanel(theme, "Session", `Renamed to: ${theme.fg("accent", name)}`, "dim"), "info");
    },
  });

  // ── /status ───────────────────────────────────────────────────────────────
  // Everything you need to know about this session in one shot.
  pi.registerCommand("status", {
    description: "Show a full session snapshot: model, thinking, mode, spec, context, and policy.",
    handler: async (_args, ctx) => {
      const policy = await policyPromise;
      const theme = ctx.ui.theme;
      const model = ctx.model;
      const thinking = pi.getThinkingLevel() as ThinkingLevel | undefined;
      const usage = ctx.getContextUsage();
      const active = spec.activeSpec;

      const modelStr = model ? (model.name || model.id) : "none";
      const thinkingStr = thinking && thinking !== "off" ? thinking : "off";
      const modeStr = String(getDefaultTaskType() ?? "ask (default)");
      const specStr = active
        ? `${formatValue(theme, active.tier, "accent")} ${theme.fg("dim", "—")} "${active.goal.length > 60 ? `${active.goal.slice(0, 57)}…` : active.goal}"`
        : theme.fg("dim", "none");

      let contextStr = theme.fg("dim", "unknown");
      if (usage) {
        const pct = usage.percent !== null ? `${Math.round(usage.percent * 100)}%` : "?%";
        const tok = usage.tokens !== null ? fmtN(usage.tokens) : "?";
        const wk = Math.round(usage.contextWindow / 1000);
        contextStr = `${formatValue(theme, tok, "accent")} tokens  ${theme.fg("dim", "(")}${usage.percent && usage.percent > 0.8 ? theme.fg("warning", pct) : theme.fg("success", pct)} of ${wk}k${theme.fg("dim", ")")}`;
      }

      const policyStr = `${formatValue(theme, policy.preset, "accent")}  ${theme.fg("dim", "—")}  ${policy.rules.length} rules  ${theme.fg("dim", "—")}  audit ${policy.audit.enabled ? theme.fg("success", "on") : theme.fg("dim", "off")}`;

      const lines = [
        `${formatLabel(theme, "Model:", 10)} ${formatValue(theme, modelStr, "accent")}`,
        `${formatLabel(theme, "Thinking:", 10)} ${formatValue(theme, thinkingStr, "accent")}`,
        `${formatLabel(theme, "Mode:", 10)} ${formatValue(theme, modeStr, "accent")}`,
        `${formatLabel(theme, "Spec:", 10)} ${specStr}`,
        `${formatLabel(theme, "Context:", 10)} ${contextStr}`,
        `${formatLabel(theme, "Policy:", 10)} ${policyStr}`,
      ];

      const panel = formatPanel(theme, "Session Snapshot", lines, "dim");
      ctx.ui.notify(panel, "info");
    },
  });
}
