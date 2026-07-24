import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AuditEvent } from "../audit/types";
import type { PermissionManager } from "../permissions/manager";
import type { SpecEngine } from "../spec/engine";
import type { HarnessPolicy } from "../policy/types";
import type { PolicyLoadState } from "../policy/state";
import type { TaskParams } from "../agents/task-tool";
import type { ThinkingLevel } from "./thinking-levels";
import { renderAuditPanel, renderPolicyPanel, renderSessionSnapshotPanel, renderSpecVerificationPanel } from "../commands/presenters";
import { formatValue, formatPanel, noopTheme } from "../ui-utils";
import { buildJuryPrompt } from "../review/jury";

/**
 * Resolve the loaded policy, or notify+return undefined on a config error.
 * Shared by the ctrl+shift+f/g/a diagnostic shortcuts below.
 */
async function requirePolicy(
  ctx: ExtensionContext,
  policyStatePromise: Promise<PolicyLoadState>,
): Promise<HarnessPolicy | undefined> {
  const policyState = await policyStatePromise;
  if (policyState.kind === "error") {
    const theme = ctx.ui.theme ?? noopTheme;
    ctx.ui.notify(formatPanel(theme, "Policy Error", policyState.error, "error"), "warning");
    return undefined;
  }
  return policyState.policy;
}

export interface DiagnosticShortcutDeps {
  isSubagent: boolean;
  policyStatePromise: Promise<PolicyLoadState>;
  spec: SpecEngine;
  permissions: PermissionManager;
  getDefaultTaskType: () => TaskParams["type"] | undefined;
}

/**
 * The five standalone diagnostic/utility shortcuts that aren't paired with a
 * slash command of their own: session snapshot (f), current spec (e), active
 * policy (g), audit log tail (a), and code review (r). ctrl+shift+k/d/y are
 * registered alongside their respective commands instead (thinking/designer/
 * yolo) since they mirror those commands' logic.
 */
export function registerDiagnosticShortcuts(pi: ExtensionAPI, deps: DiagnosticShortcutDeps): void {
  // Moved from ctrl+shift+s to avoid conflict with pi-web-access curator
  pi.registerShortcut("ctrl+shift+f", {
    description: "Show session snapshot: model, thinking, mode, spec, context, policy",
    handler: async (ctx) => {
      const policy = await requirePolicy(ctx, deps.policyStatePromise);
      if (!policy) return;
      const theme = ctx.ui.theme;
      const model = ctx.model;
      const thinking = pi.getThinkingLevel() as ThinkingLevel | undefined;
      const usage = ctx.getContextUsage();
      const active = deps.spec.activeSpec;

      const modelStr = model ? (model.name || model.id) : "none";
      const thinkingStr = thinking && thinking !== "off" ? thinking : "off";
      const modeStr = String(deps.getDefaultTaskType() ?? "explore (default)");

      let contextStr = theme.fg("dim", "unknown");
      if (usage) {
        const pct = usage.percent !== null ? `${Math.round(usage.percent * 100)}%` : "?%";
        const tok = usage.tokens !== null ? usage.tokens.toLocaleString() : "?";
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
        yolo: deps.permissions.isYolo,
      });
      ctx.ui.notify(panel, "info");
    },
  });

  pi.registerShortcut("ctrl+shift+e", {
    description: "Show current spec: goal, tier, criteria, verification state",
    handler: async (ctx) => {
      const active = deps.spec.activeSpec;
      const theme = ctx.ui.theme;
      if (!active) {
        ctx.ui.notify(
          "No active spec.\nSpecs generate on ambient and explicit tasks — not instant reads.",
          "info",
        );
        return;
      }
      const presentation = renderSpecVerificationPanel(theme, active, deps.spec.verify());
      ctx.ui.notify(presentation.panel, presentation.notification);
    },
  });

  pi.registerShortcut("ctrl+shift+g", {
    description: "Show active policy: preset, rules, audit status",
    handler: async (ctx) => {
      const policy = await requirePolicy(ctx, deps.policyStatePromise);
      if (!policy) return;
      const theme = ctx.ui.theme;
      ctx.ui.notify(renderPolicyPanel(theme, policy), "info");
    },
  });

  pi.registerShortcut("ctrl+shift+a", {
    description: "Show last 10 audit log entries",
    handler: async (ctx) => {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const policy = await requirePolicy(ctx, deps.policyStatePromise);
      if (!policy) return;
      const theme = ctx.ui.theme;
      if (!policy.audit.enabled) {
        ctx.ui.notify(
          "Audit logging is off for this policy preset.\nSet audit.enabled = true in harness.policy.json to enable it.",
          "warning",
        );
        return;
      }
      const auditPath = policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl");
      let raw: string;
      try {
        raw = await readFile(auditPath, "utf-8");
      } catch {
        ctx.ui.notify("No audit log yet.\nIt gets written on the first governed tool call.", "info");
        return;
      }
      const entries = raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-10)
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .filter((e): e is AuditEvent => e !== null);
      if (entries.length === 0) { ctx.ui.notify("Audit log is empty.", "info"); return; }
      ctx.ui.notify(renderAuditPanel(theme, entries), "info");
    },
  });

  pi.registerShortcut("ctrl+shift+r", {
    description: "Run a code review — spawns a heterogeneous critic jury",
    handler: async (ctx) => {
      if (deps.isSubagent) {
        ctx.ui.notify("Code review is only available in the main session.", "warning");
        return;
      }
      ctx.ui.notify("Delegating code review to the heterogeneous jury…", "info");
      await pi.sendUserMessage(buildJuryPrompt(), { deliverAs: "followUp" });
    },
  });
}
