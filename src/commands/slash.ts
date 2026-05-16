import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AuditEvent } from "../audit/types";
import type { PermissionManager } from "../permissions/manager";
import { capabilityForTool } from "../governance/tool-call";
import type { PolicyLoadState } from "../policy/state";
import type { SpecEngine } from "../spec/engine";
import type { TaskParams } from "../agents/task-tool";
import { runWorktreeGc } from "../agents/task-tool";
import { formatBadge, formatLabel, formatValue, formatPanel } from "../ui-utils";
import { renderAuditPanel, renderPolicyPanel, renderSessionSnapshotPanel, renderSpecVerificationPanel } from "../commands/presenters";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";



function fmtN(n: number): string {
  return n.toLocaleString();
}

export function registerSlashCommands(
  pi: ExtensionAPI,
  opts: {
    permissions: PermissionManager;
    spec: SpecEngine;
    policyPromise: Promise<PolicyLoadState>;
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
      const policyState = await policyPromise;
      const theme = ctx.ui.theme;
      if (policyState.kind === "error") {
        ctx.ui.notify(formatPanel(theme, "Policy Error", policyState.error, "error"), "warning");
        return;
      }
      ctx.ui.notify(renderPolicyPanel(theme, policyState.policy), "info");
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
        const cap = capabilityForTool(tool.name);
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
      const presentation = renderSpecVerificationPanel(theme, active, spec.verify());
      ctx.ui.notify(presentation.panel, presentation.notification);
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
      const policyState = await policyPromise;
      const theme = ctx.ui.theme;
      if (policyState.kind === "error") {
        ctx.ui.notify(formatPanel(theme, "Policy Error", policyState.error, "error"), "warning");
        return;
      }
      const { policy } = policyState;

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

      ctx.ui.notify(renderAuditPanel(theme, entries), "info");
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
      const policyState = await policyPromise;
      const theme = ctx.ui.theme;
      if (policyState.kind === "error") {
        ctx.ui.notify(formatPanel(theme, "Policy Error", policyState.error, "error"), "warning");
        return;
      }
      const { policy } = policyState;
      const model = ctx.model;
      const thinking = pi.getThinkingLevel() as ThinkingLevel | undefined;
      const usage = ctx.getContextUsage();
      const active = spec.activeSpec;

      const modelStr = model ? (model.name || model.id) : "none";
      const thinkingStr = thinking && thinking !== "off" ? thinking : "off";
      const modeStr = String(getDefaultTaskType() ?? "ask (default)");

      let contextStr = theme.fg("dim", "unknown");
      if (usage) {
        const pct = usage.percent !== null ? `${Math.round(usage.percent * 100)}%` : "?%";
        const tok = usage.tokens !== null ? fmtN(usage.tokens) : "?";
        const wk = Math.round(usage.contextWindow / 1000);
        contextStr = `${formatValue(theme, tok, "accent")} tokens  ${theme.fg("dim", "(")}${usage.percent && usage.percent > 0.8 ? theme.fg("warning", pct) : theme.fg("success", pct)} of ${wk}k${theme.fg("dim", ")")}`;
      }

      const panel = renderSessionSnapshotPanel(theme, {
        modelStr,
        thinkingStr,
        modeStr,
        spec: active,
        contextStr,
        policy,
        yolo: permissions.isYolo,
      });
      ctx.ui.notify(panel, "info");
    },
  });

  // ── /worktree ─────────────────────────────────────────────────────────────
  pi.registerCommand("worktree", {
    description: "Manage subagent worktrees. Usage: /worktree gc",
    handler: async (args, ctx) => {
      const theme = ctx.ui.theme;
      const sub = (args ?? "").trim().toLowerCase();

      if (sub !== "gc") {
        ctx.ui.notify(
          formatPanel(theme, "Worktree", "Usage: /worktree gc — remove orphaned worktrees from crashed runs", "dim"),
          "info",
        );
        return;
      }

      ctx.ui.notify(formatPanel(theme, "Worktree GC", "Scanning for orphaned worktrees…", "dim"), "info");
      try {
        const removed = await runWorktreeGc(process.cwd());
        if (removed.length === 0) {
          ctx.ui.notify(formatPanel(theme, "Worktree GC", theme.fg("success", "No orphaned worktrees found."), "dim"), "info");
        } else {
          const lines = removed.map((wt) => `  ${theme.fg("dim", "removed")} ${wt.branch}`);
          ctx.ui.notify(
            formatPanel(theme, `Worktree GC — ${removed.length} removed`, lines, "dim"),
            "info",
          );
        }
      } catch (err) {
        ctx.ui.notify(formatPanel(theme, "Worktree GC Error", String(err), "error"), "warning");
      }
    },
  });
}
