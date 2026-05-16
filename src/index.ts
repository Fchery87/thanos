// src/index.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

import { AuditLogger } from "./audit/logger";
import type { AuditEvent } from "./audit/types";
import { PermissionManager } from "./permissions/manager";
import { SpecEngine } from "./spec/engine";
import { makeBeforeToolHandler } from "./hooks/before-tool";
import { makeAfterToolHandler } from "./hooks/after-tool";
import { TaskParamsSchema, executeTask, type TaskParams } from "./agents/task-tool";
import { loadPolicyState } from "./policy/state";
import type { FormalSpec } from "./spec/types";
import { chooseTaskType } from "./agents/selector";
import { registerSlashCommands } from "./commands/slash";
import { MCPManager } from "./mcp/manager";
import { loadMcpConfigs, mcpConfigPaths } from "./mcp/config";
import { writeServerSecrets, readServerSecrets } from "./mcp/state";
import { runOAuthFlow, probeOAuth } from "./mcp/oauth";
import {
  connectMcpServer,
  disableMcpServer,
  disconnectMcpServer,
  enableMcpServer,
  initializeMcpSession,
  reloadMcpSession,
} from "./mcp/lifecycle";
import { formatLabel, formatValue, formatSpecForApproval, formatPanel, noopTheme } from "./ui-utils";
import { renderAuditPanel, renderPolicyPanel, renderSessionSnapshotPanel, renderSpecVerificationPanel } from "./commands/presenters";
import { renderWelcomeHeader, formatTimeAgo, type WelcomeMcpSummary, type WelcomePolicySummary } from "./welcome/header";
import { MemoryStore } from "./memory/store";
import { shouldSaveMemory, extractCorrection, formatMemoriesForInjection } from "./memory/injector";
import { routeModel, formatRouteStatus, formatRouteNotice } from "./models/router";
import { scanContent, formatScanResult } from "./security/scanner";
import { createSnapshot } from "./security/snapshot";
import { classifyRisk } from "./permissions/risk";
import { registerSearchTool } from "./web/search/index";
import { AskParamsSchema, buildAskDecision, resolveHeadlessAsk, type AskQuestion } from "./interaction/ask";
import { createTodoState, applyTodoOperation, exportTodoMarkdown, TodoParamsSchema, type TodoOperation, type TodoState } from "./interaction/todo";
import { FindingParamsSchema, addFinding, formatReviewSummary, type ReviewFinding } from "./review/findings";


type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off:     "off      — no reasoning",
  minimal: "minimal  — ~1k tokens",
  low:     "low      — ~2k tokens",
  medium:  "medium   — ~8k tokens",
  high:    "high     — ~16k tokens",
  xhigh:   "xhigh    — ~32k tokens",
};

function getSupportedLevels(model: { reasoning: boolean; thinkingLevelMap?: Partial<Record<string, string | null>> }): ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  return ALL_THINKING_LEVELS.filter((level) => model.thinkingLevelMap?.[level] !== null);
}

function setThinkingStatus(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const level = pi.getThinkingLevel() as ThinkingLevel | undefined;
  ctx.ui.setStatus("harness-thinking", level && level !== "off" ? ctx.ui.theme.fg("accent", `thinking:${level}`) : undefined);
}


export default function register(pi: ExtensionAPI, deps?: { executeTask?: typeof executeTask }) {
  const _executeTask = deps?.executeTask ?? executeTask;
  const subagentRole = process.env.HARNESS_SUBAGENT; // undefined | "1" | "reviewer"
  const isSubagent = !!subagentRole;
  const isReviewer = subagentRole === "reviewer";
  let defaultTaskType: TaskParams["type"] | undefined;
  let todoState: TodoState = createTodoState([]);
  let reviewFindings: ReviewFinding[] = [];

  const permissions = new PermissionManager();
  const spec = new SpecEngine();
  const policyStatePromise = loadPolicyState(process.cwd(), process.env.HARNESS_POLICY_FILE);

  async function requirePolicy(ctx: ExtensionContext) {
    const policyState = await policyStatePromise;
    if (policyState.kind === "error") {
      const theme = ctx.ui.theme ?? noopTheme;
      ctx.ui.notify(formatPanel(theme, "Policy Error", policyState.error, "error"), "warning");
      return undefined;
    }
    return policyState.policy;
  }

  // ── MCP server management (main session only) ───────────────────────
  const mcpManager = isSubagent ? null : new MCPManager();

  pi.on("session_start", async (event, ctx) => {
    if (!mcpManager) return;

    const theme = ctx.ui.theme;

    let mcpSummary: WelcomeMcpSummary = { configured: 0, connected: 0, failed: 0, initFailed: false };
    const init = await initializeMcpSession({ manager: mcpManager, pi, cwd: ctx.cwd });
    mcpSummary = {
      configured: init.statuses.length,
      connected: init.connectedCount,
      failed: init.statuses.filter((s) => s.error).length,
      initFailed: init.kind === "failed",
    };
    if (init.kind === "failed") {
      ctx.ui.notify(`MCP init failed: ${init.error}`, "warning");
    } else {
      const statuses = init.statuses;
      const connected = statuses.filter((s) => !s.error);
      const failed = statuses.filter((s) => s.error);
      mcpSummary = {
        configured: statuses.length,
        connected: init.connectedCount,
        failed: failed.length,
        initFailed: false,
      };
      if (connected.length > 0) {
        ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${connected.length}`));
      }
      if (failed.length > 0) {
        const summary = failed.map((s) => `${theme.fg("error", s.name)}: ${s.error}`).join("\n  ");
        const panel = formatPanel(theme, "MCP Failed", summary, "error");
        ctx.ui.notify(panel, "warning");
      }
    }

    // ── Thanos welcome header — two-column layout, clears on first prompt ─
    if (event.reason === "startup" || event.reason === "new") {
      const model = ctx.model;
      const modelStr = model ? (model.name || model.id) : "—";
      const thinkingStr = (pi.getThinkingLevel() as string) || "off";
      const policyState = await policyStatePromise;
      const policy: WelcomePolicySummary = policyState.kind === "ok"
        ? {
            kind: "loaded",
            preset: policyState.policy.preset,
            rules: policyState.policy.rules.length,
            auditEnabled: policyState.policy.audit.enabled,
          }
        : { kind: "error" };

      type SessionRow = { label: string; age: string };
      let recentRows: SessionRow[] = [];
      try {
        const sessions = await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
        recentRows = sessions
          .sort((a, b) => b.modified.getTime() - a.modified.getTime())
          .slice(0, 5)
          .map((s) => ({
            label: (s.name || s.firstMessage || "Untitled").slice(0, 72),
            age: formatTimeAgo(s.modified),
          }));
      } catch { /* session dir may not exist yet */ }

      ctx.ui.setHeader((_tui, theme) => renderWelcomeHeader(theme, {
        modelStr,
        thinkingStr,
        modeStr: String(defaultTaskType ?? "explore (default)"),
        mcp: mcpSummary,
        policy,
        recentRows,
      }));
    }
  });

  // ── --spec flag ────────────────────────────────────────────────────
  pi.registerFlag("spec", {
    type: "boolean",
    default: false,
    description: "Require approval before first edit/exec when task is ambient",
  });

  pi.registerCommand("modes", {
    description: "Choose the default specialist subagent for this session",
    getArgumentCompletions: (prefix) => {
      const modes = ["explore", "plan", "build", "reviewer", "designer"];
      const filtered = modes.filter((mode) => mode.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const explicit = ["explore", "plan", "build", "reviewer", "designer"].includes(trimmed) ? (trimmed as NonNullable<TaskParams["type"]>) : undefined;
      if (!ctx.hasUI && !explicit) {
        ctx.ui.notify("Modes selector requires an interactive UI", "warning");
        return;
      }

      const selected = explicit ?? (await ctx.ui.select("Choose a default subagent mode", ["explore", "plan", "build", "reviewer", "designer"]));
      if (!selected) return;
      defaultTaskType = selected as NonNullable<TaskParams["type"]>;
      ctx.ui.setStatus("harness-mode", ctx.ui.theme.fg("accent", `modes:${selected}`));
      ctx.ui.notify(`Default subagent mode: ${selected}`, "info");
    },
  });

  // ── /yolo — bypass all permission checks ──────────────────────────
  pi.registerCommand("yolo", {
    description: "Toggle yolo mode — skips all permission prompts and policy checks.",
    handler: async (_args, ctx) => {
      const theme = ctx.ui.theme;
      const current = permissions.isYolo;

      if (!current) {
        // Require explicit confirmation before enabling
        if (ctx.hasUI) {
          const ok = await ctx.ui.confirm(
            "Enable Yolo Mode?",
            "All permission checks, policy rules, and confirmation prompts will be bypassed.\n" +
            "The agent will execute any tool without asking. Use in trusted environments only.",
          );
          if (!ok) {
            ctx.ui.notify("Yolo mode not enabled.", "info");
            return;
          }
        }
        permissions.setYolo(true);
        ctx.ui.setStatus("harness-yolo", theme.fg("error", "⚡ yolo"));
        ctx.ui.notify(
          formatPanel(theme, "Yolo Mode ON", [
            theme.fg("warning", "All permission checks are now bypassed."),
            theme.fg("dim", "Run /yolo again to restore normal permission behavior."),
          ], "warning"),
          "warning",
        );
      } else {
        permissions.setYolo(false);
        ctx.ui.setStatus("harness-yolo", undefined);
        ctx.ui.notify(
          formatPanel(theme, "Yolo Mode OFF", "Permission checks restored.", "dim"),
          "info",
        );
      }
    },
  });

  // ── /mcp — MCP server lifecycle management ───────────────────────

  pi.registerCommand("mcp", {
    description: "Manage MCP servers: list, enable, disable, auth, connect, reload…",
    getArgumentCompletions: async (prefix) => {
      const SUBS = ["list", "reload", "paths", "enable", "disable", "auth", "reauth", "connect", "disconnect"];
      // If nothing typed yet or still on the subcommand, complete subcommands
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length <= 1) {
        const filtered = SUBS.filter((s) => s.startsWith(parts[0] ?? ""));
        return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
      }
      // Second token: complete server names for subcommands that take one
      const sub = parts[0]!;
      const nameSubs = ["enable", "disable", "auth", "reauth", "connect", "disconnect"];
      if (nameSubs.includes(sub)) {
        const names = mcpManager ? mcpManager.getKnownNames() : Object.keys((await loadMcpConfigs(process.cwd())).merged);
        const namePrefix = parts[1] ?? "";
        const filtered = names.filter((n) => n.startsWith(namePrefix));
        return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
      }
      return null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub   = parts[0] ?? "";
      const name  = parts[1] ?? "";
      const theme = ctx.ui.theme;

      // ── paths ────────────────────────────────────────────────────────────
      if (sub === "paths") {
        const paths = mcpConfigPaths(ctx.cwd);
        const content = [
          theme.bold("MCP config file locations:"),
          `  ${formatLabel(theme, "global", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.global)}`,
          `  ${formatLabel(theme, "user", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.user)}`,
          `  ${formatLabel(theme, "project", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.project)}`,
        ].join("\n");
        ctx.ui.notify(formatPanel(theme, "MCP Configs", content, "dim"), "info");
        return;
      }

      // ── reload ───────────────────────────────────────────────────────────
      if (sub === "reload") {
        if (isSubagent) { ctx.ui.notify("/mcp reload is only available in the main session.", "warning"); return; }
        if (!mcpManager) return;
        const result = await reloadMcpSession({ manager: mcpManager, pi, cwd: ctx.cwd });
        if (result.kind === "failed") {
          ctx.ui.notify(`MCP reload failed: ${result.error}`, "warning");
        } else {
          ctx.ui.notify(`${theme.bold("MCP reloaded")} ${theme.fg("dim", "—")} ${theme.fg("success", String(result.connectedCount))} server(s) connected.`, "info");
        }
        return;
      }

      // ── disable <name> ───────────────────────────────────────────────────
      if (sub === "disable") {
        if (isSubagent) { ctx.ui.notify("/mcp disable is only available in the main session.", "warning"); return; }
        if (!mcpManager) return;
        if (!name) { ctx.ui.notify("Usage: /mcp disable <server-name>", "warning"); return; }
        const result = await disableMcpServer({ manager: mcpManager, name });
        if (result.kind === "unknown-server") { ctx.ui.notify(`Unknown server: ${theme.fg("error", name)}`, "warning"); return; }
        if (result.kind === "failed") { ctx.ui.notify(`MCP disable failed: ${result.error}`, "warning"); return; }
        ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
        ctx.ui.notify(formatPanel(theme, "MCP Disabled", `${theme.fg("error", name)} disconnected and marked disabled.`, "warning"), "info");
        return;
      }

      // ── enable <name> ────────────────────────────────────────────────────
      if (sub === "enable") {
        if (isSubagent) { ctx.ui.notify("/mcp enable is only available in the main session.", "warning"); return; }
        if (!mcpManager) return;
        if (!name) { ctx.ui.notify("Usage: /mcp enable <server-name>", "warning"); return; }
        ctx.ui.notify(`Connecting ${theme.fg("accent", name)}…`, "info");
        const result = await enableMcpServer({ manager: mcpManager, pi, name });
        if (result.kind === "unknown-server") { ctx.ui.notify(`Unknown server: ${theme.fg("error", name)}`, "warning"); return; }
        if (result.kind === "failed") {
          ctx.ui.notify(formatPanel(theme, "MCP Enable Failed", `${theme.fg("error", name)}: ${result.status?.error ?? result.error}`, "error"), "warning");
        } else {
          ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
          ctx.ui.notify(formatPanel(theme, "MCP Enabled", `${theme.fg("success", name)} connected — ${result.status?.toolCount ?? 0} tool(s).`, "dim"), "info");
        }
        return;
      }

      // ── connect <name> ───────────────────────────────────────────────────
      if (sub === "connect") {
        if (isSubagent) { ctx.ui.notify("/mcp connect is only available in the main session.", "warning"); return; }
        if (!mcpManager) return;
        if (!name) { ctx.ui.notify("Usage: /mcp connect <server-name>", "warning"); return; }
        ctx.ui.notify(`Connecting ${theme.fg("accent", name)}…`, "info");
        const result = await connectMcpServer({ manager: mcpManager, pi, name });
        if (result.kind === "unknown-server") { ctx.ui.notify(`Unknown server: ${theme.fg("error", name)}`, "warning"); return; }
        if (result.kind === "failed") {
          ctx.ui.notify(formatPanel(theme, "MCP Connect Failed", `${theme.fg("error", name)}: ${result.status?.error ?? result.error}`, "error"), "warning");
        } else {
          ctx.ui.notify(formatPanel(theme, "MCP Connected", `${theme.fg("success", name)} — ${result.status?.toolCount ?? 0} tool(s).`, "dim"), "info");
        }
        return;
      }

      // ── disconnect <name> ────────────────────────────────────────────────
      if (sub === "disconnect") {
        if (isSubagent) { ctx.ui.notify("/mcp disconnect is only available in the main session.", "warning"); return; }
        if (!mcpManager) return;
        if (!name) { ctx.ui.notify("Usage: /mcp disconnect <server-name>", "warning"); return; }
        const result = disconnectMcpServer({ manager: mcpManager, name });
        if (result.kind === "unknown-server" || result.kind === "not-connected") {
          ctx.ui.notify(`${theme.fg("error", name)} is not connected.`, "warning");
          return;
        }
        if (result.kind === "failed") { ctx.ui.notify(`MCP disconnect failed: ${result.error}`, "warning"); return; }
        ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
        ctx.ui.notify(formatPanel(theme, "MCP Disconnected", `${theme.fg("accent", name)} disconnected (not disabled — run /mcp connect ${name} to reconnect).`, "dim"), "info");
        return;
      }

      // ── auth <name> / reauth <name> ──────────────────────────────────────
      if (sub === "auth" || sub === "reauth") {
        if (isSubagent) { ctx.ui.notify(`/mcp ${sub} is only available in the main session.`, "warning"); return; }
        if (!mcpManager) return;
        if (!name) { ctx.ui.notify(`Usage: /mcp ${sub} <server-name>`, "warning"); return; }
        if (!ctx.hasUI) { ctx.ui.notify(`/mcp ${sub} requires an interactive UI.`, "warning"); return; }

        const config = mcpManager.getConfig(name);
        if (!config) { ctx.ui.notify(`Unknown server: ${theme.fg("error", name)}`, "warning"); return; }

        // Load existing secrets to show in reauth
        const existing = sub === "reauth" ? await readServerSecrets(name) : {};

        if (config.type === "stdio") {
          // Collect env vars one at a time: KEY then VALUE
          const existingKeys = sub === "reauth" && existing.env ? Object.keys(existing.env) : [];
          const hintStr = existingKeys.length > 0 ? existingKeys.map((k) => `${k}=***`).join(", ") : "";
          const key = await ctx.ui.input(
            `Set env var for ${name} — KEY`,
            hintStr ? `Existing: ${hintStr}` : "e.g. OPENAI_API_KEY",
          );
          if (!key?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
          const val = await ctx.ui.input(
            `Set env var for ${name} — VALUE for ${key.trim()}`,
            "(hidden after saving)",
          );
          if (val === undefined) { ctx.ui.notify("Auth cancelled.", "info"); return; }
          await writeServerSecrets(name, { env: { [key.trim()]: val } });
        } else {
          // HTTP server: check for OAuth first
          if (!config.url) { ctx.ui.notify(`${theme.fg("error", name)} is missing a URL.`, "warning"); return; }
          const needsOAuth = await probeOAuth(config.url);
          if (needsOAuth) {
            ctx.ui.notify(
              formatPanel(theme, "OAuth Authorization",
                `Opening browser for ${theme.fg("accent", name)}…\n${theme.fg("dim", "Complete the flow in your browser, then return here.")}`,
                "dim"),
              "info",
            );
            try {
              const { accessToken } = await runOAuthFlow(config.url);
              await writeServerSecrets(name, { headers: { Authorization: `Bearer ${accessToken}` } });
            } catch (err) {
              ctx.ui.notify(
                formatPanel(theme, "OAuth Failed", String(err), "error"),
                "warning",
              );
              return;
            }
          } else {
            const existingHdrs = sub === "reauth" && existing.headers ? Object.keys(existing.headers) : [];
            const hintStr = existingHdrs.length > 0 ? existingHdrs.map((k) => `${k}: ***`).join(", ") : "";
            const header = await ctx.ui.input(`Set header for ${name} — Header name`, hintStr ? `Existing: ${hintStr}` : "e.g. Authorization");
            if (!header?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
            const val = await ctx.ui.input(`Set header for ${name} — Value for ${header.trim()}`, "e.g. Bearer sk-…");
            if (val === undefined) { ctx.ui.notify("Auth cancelled.", "info"); return; }
            await writeServerSecrets(name, { headers: { [header.trim()]: val.trim() } });
          }
        }

        // Reconnect to pick up new credentials
        ctx.ui.notify(`Credentials saved. Reconnecting ${theme.fg("accent", name)}…`, "info");
        const reconnect = await connectMcpServer({ manager: mcpManager, pi, name });
        if (reconnect.kind === "unknown-server") {
          ctx.ui.notify(`Unknown server: ${theme.fg("error", name)}`, "warning");
        } else if (reconnect.kind === "failed") {
          ctx.ui.notify(formatPanel(theme, "Reconnect Failed", `${theme.fg("error", name)}: ${reconnect.status?.error ?? reconnect.error}`, "error"), "warning");
        } else {
          ctx.ui.notify(formatPanel(theme, "Auth Complete", `${theme.fg("success", name)} — ${reconnect.status?.toolCount ?? 0} tool(s) ready.`, "dim"), "info");
        }
        return;
      }

      // ── list (default) ───────────────────────────────────────────────────
      if (isSubagent) {
        const { merged, sources } = await loadMcpConfigs(ctx.cwd);
        const names = Object.keys(merged);
        if (names.length === 0) {
          ctx.ui.notify("No MCP servers configured.\nRun /mcp paths to see where to add them.", "info");
          return;
        }
        const lines = names.map((n) => `  ${theme.fg("accent", n)}  ${theme.fg("dim", `[${sources[n]}]`)}`);
        ctx.ui.notify(formatPanel(theme, "MCP Configured", lines, "dim"), "info");
        return;
      }

      if (!mcpManager) return;
      const statuses = mcpManager.getStatuses();
      if (statuses.length === 0) {
        const paths = mcpConfigPaths(ctx.cwd);
        const content = [
          "No MCP servers configured.",
          "",
          "Add servers to any of:",
          `  ${formatLabel(theme, "global", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.global)}`,
          `  ${formatLabel(theme, "user", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.user)}`,
          `  ${formatLabel(theme, "project", 8)} ${theme.fg("dim", "→")} ${theme.fg("accent", paths.project)}`,
        ].join("\n");
        ctx.ui.notify(formatPanel(theme, "MCP Setup", content, "warning"), "info");
        return;
      }

      // ── Interactive mode: pick a server, then pick an action ─────────
      if (ctx.hasUI) {
        // Build labelled options showing server state inline
        const options = statuses.map((s) => {
          if (s.disabled) return `○  ${s.name}  [${s.source}]  disabled`;
          const icon   = s.error ? "✗" : "✓";
          const detail = s.error ? `error` : `${s.toolCount} tools`;
          return `${icon}  ${s.name}  [${s.source}]  ${detail}`;
        });

        const picked = await ctx.ui.select("Select an MCP server", options);
        if (!picked) return;

        // Resolve which status entry was chosen
        const idx    = options.indexOf(picked);
        const status = statuses[idx];
        if (!status) return;
        const sName = status.name;

        // Build contextual action list based on current state
        const actions: string[] = [];
        if (status.disabled) {
          actions.push("enable — reconnect this server");
        } else {
          if (status.connected) {
            actions.push("disconnect — drop connection (keeps enabled)");
            actions.push("disable — disconnect and mark disabled");
          } else {
            actions.push("connect — (re)connect this server");
            actions.push("disable — mark disabled");
          }
          actions.push("auth — set / update credentials, then reconnect");
          actions.push("reauth — edit existing credentials, then reconnect");
        }

        const action = await ctx.ui.select(`Action for: ${sName}`, actions);
        if (!action) return;
        const verb = action.split(" ")[0]!;

        // Dispatch via the same lifecycle helpers used by explicit subcommands
        if (verb === "enable") {
          ctx.ui.notify(`Connecting ${theme.fg("accent", sName)}…`, "info");
          const result = await enableMcpServer({ manager: mcpManager, pi, name: sName });
          if (result.kind === "unknown-server") {
            ctx.ui.notify(`Unknown server: ${theme.fg("error", sName)}`, "warning");
          } else if (result.kind === "failed") {
            ctx.ui.notify(
              formatPanel(theme, "Enable Failed", `${theme.fg("error", sName)}: ${result.status?.error ?? result.error}`, "error"),
              "warning",
            );
          } else {
            ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
            ctx.ui.notify(
              result.status?.error
                ? formatPanel(theme, "Enable Failed", `${theme.fg("error", sName)}: ${result.status.error}`, "error")
                : formatPanel(theme, "MCP Enabled", `${theme.fg("success", sName)} — ${result.status?.toolCount ?? 0} tool(s).`, "dim"),
              result.status?.error ? "warning" : "info",
            );
          }

        } else if (verb === "disable") {
          const result = await disableMcpServer({ manager: mcpManager, name: sName });
          if (result.kind === "unknown-server") {
            ctx.ui.notify(`Unknown server: ${theme.fg("error", sName)}`, "warning");
          } else if (result.kind === "failed") {
            ctx.ui.notify(`MCP disable failed: ${result.error}`, "warning");
          } else {
            ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
            ctx.ui.notify(formatPanel(theme, "MCP Disabled", `${theme.fg("error", sName)} disconnected and marked disabled.`, "warning"), "info");
          }

        } else if (verb === "connect") {
          ctx.ui.notify(`Connecting ${theme.fg("accent", sName)}…`, "info");
          const result = await connectMcpServer({ manager: mcpManager, pi, name: sName });
          if (result.kind === "unknown-server") {
            ctx.ui.notify(`Unknown server: ${theme.fg("error", sName)}`, "warning");
          } else if (result.kind === "failed") {
            ctx.ui.notify(
              formatPanel(theme, "Connect Failed", `${theme.fg("error", sName)}: ${result.status?.error ?? result.error}`, "error"),
              "warning",
            );
          } else {
            ctx.ui.notify(formatPanel(theme, "MCP Connected", `${theme.fg("success", sName)} — ${result.status?.toolCount ?? 0} tool(s).`, "dim"), "info");
          }

        } else if (verb === "disconnect") {
          const result = disconnectMcpServer({ manager: mcpManager, name: sName });
          if (result.kind === "unknown-server" || result.kind === "not-connected") {
            ctx.ui.notify(`${theme.fg("error", sName)} is not connected.`, "warning");
          } else if (result.kind === "failed") {
            ctx.ui.notify(`MCP disconnect failed: ${result.error}`, "warning");
          } else {
            ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${result.connectedCount}`));
            ctx.ui.notify(formatPanel(theme, "MCP Disconnected", `${theme.fg("accent", sName)} disconnected (run /mcp connect ${sName} to reconnect).`, "dim"), "info");
          }

        } else if (verb === "auth" || verb === "reauth") {
          const config = mcpManager.getConfig(sName);
          if (!config) return;
          const existing = verb === "reauth" ? await readServerSecrets(sName) : {};
          if (config.type === "stdio") {
            const existingKeys = verb === "reauth" && existing.env ? Object.keys(existing.env) : [];
            const hintStr = existingKeys.length > 0 ? existingKeys.map((k) => `${k}=***`).join(", ") : "";
            const key = await ctx.ui.input(`Env var KEY for ${sName}`, hintStr ? `Existing: ${hintStr}` : "e.g. OPENAI_API_KEY");
            if (!key?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
            const val = await ctx.ui.input(`Value for ${key.trim()}`, "(hidden after saving)");
            if (val === undefined) { ctx.ui.notify("Auth cancelled.", "info"); return; }
            await writeServerSecrets(sName, { env: { [key.trim()]: val } });
          } else {
            // HTTP server: probe for OAuth, run browser flow if detected
            if (!config.url) { ctx.ui.notify(`${theme.fg("error", sName)} is missing a URL.`, "warning"); return; }
            const needsOAuth = await probeOAuth(config.url);
            if (needsOAuth) {
              ctx.ui.notify(
                formatPanel(theme, "OAuth Authorization",
                  `Opening browser for ${theme.fg("accent", sName)}…\n${theme.fg("dim", "Complete the flow in your browser, then return here.")}`,
                  "dim"),
                "info",
              );
              try {
                const { accessToken } = await runOAuthFlow(config.url);
                await writeServerSecrets(sName, { headers: { Authorization: `Bearer ${accessToken}` } });
              } catch (err) {
                ctx.ui.notify(
                  formatPanel(theme, "OAuth Failed", String(err), "error"),
                  "warning",
                );
                return;
              }
            } else {
              const existingHdrs = verb === "reauth" && existing.headers ? Object.keys(existing.headers) : [];
              const hintStr = existingHdrs.length > 0 ? existingHdrs.map((k) => `${k}: ***`).join(", ") : "";
              const header = await ctx.ui.input(`Header name for ${sName}`, hintStr ? `Existing: ${hintStr}` : "e.g. Authorization");
              if (!header?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
              const val = await ctx.ui.input(`Value for ${header.trim()}`, "e.g. Bearer sk-…");
              if (val === undefined) { ctx.ui.notify("Auth cancelled.", "info"); return; }
              await writeServerSecrets(sName, { headers: { [header.trim()]: val.trim() } });
            }
          }
          ctx.ui.notify(`Credentials saved. Reconnecting ${theme.fg("accent", sName)}…`, "info");
          const reconnect = await connectMcpServer({ manager: mcpManager, pi, name: sName });
          if (reconnect.kind === "unknown-server") {
            ctx.ui.notify(`Unknown server: ${theme.fg("error", sName)}`, "warning");
          } else if (reconnect.kind === "failed") {
            ctx.ui.notify(formatPanel(theme, "Reconnect Failed", `${theme.fg("error", sName)}: ${reconnect.status?.error ?? reconnect.error}`, "error"), "warning");
          } else {
            ctx.ui.notify(formatPanel(theme, "Auth Complete", `${theme.fg("success", sName)} — ${reconnect.status?.toolCount ?? 0} tool(s) ready.`, "dim"), "info");
          }
        }
        return;
      }

      // ── Headless fallback: print static panel ─────────────────────────
      const lines = statuses.map((s) => {
        if (s.disabled) {
          return `  ${theme.fg("dim", "○")} ${theme.fg("dim", s.name.padEnd(20, " "))} ${theme.fg("dim", `[${s.source}]`)}  ${theme.fg("dim", "disabled")}`;
        }
        const tag    = s.error ? theme.fg("error", "✗") : theme.fg("success", "✓");
        const detail = s.error ? theme.fg("error", s.error) : `${s.toolCount} tool(s)`;
        return `  ${tag} ${theme.fg("accent", s.name.padEnd(20, " "))} ${theme.fg("dim", `[${s.source}]`)}  ${theme.fg("dim", "—")} ${detail}`;
      });
      const ok = statuses.filter((s) => s.connected).length;
      const dis = statuses.filter((s) => s.disabled).length;
      const title = dis > 0
        ? `MCP Status (${ok}/${statuses.length} connected, ${dis} disabled)`
        : `MCP Status (${ok}/${statuses.length} connected)`;
      ctx.ui.notify(formatPanel(theme, title, lines, "dim"), "info");
    },
  });

  // ── Thinking level selector ────────────────────────────────────────
  pi.registerCommand("thinking", {
    description: "Select reasoning effort level for the current model",
    getArgumentCompletions: (prefix) => {
      const filtered = ALL_THINKING_LEVELS.filter((l) => l.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim() as ThinkingLevel;
      if (ALL_THINKING_LEVELS.includes(trimmed)) {
        pi.setThinkingLevel(trimmed);
        setThinkingStatus(pi, ctx);
        ctx.ui.notify(`Thinking: ${trimmed}`, "info");
        return;
      }
      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("No model active", "warning");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("Thinking selector requires an interactive UI", "warning");
        return;
      }
      const levels = getSupportedLevels(model);
      const options = levels.map((l) => THINKING_LABELS[l]);
      const selected = await ctx.ui.select("Select thinking level", options);
      if (!selected) return;
      const level = levels[options.indexOf(selected)];
      if (!level) return;
      pi.setThinkingLevel(level);
      setThinkingStatus(pi, ctx);
    },
  });

  // ── Auto-prompt thinking level when switching to a reasoning model ──
  pi.on("model_select", async (event, ctx) => {
    if (!event.model.reasoning) {
      ctx.ui.setStatus("harness-thinking", undefined);
      return;
    }
    if (!ctx.hasUI) return;
    const levels = getSupportedLevels(event.model);
    const options = levels.map((l) => THINKING_LABELS[l]);
    const selected = await ctx.ui.select("Select thinking level", options);
    if (!selected) return;
    const level = levels[options.indexOf(selected)];
    if (!level) return;
    pi.setThinkingLevel(level);
    setThinkingStatus(pi, ctx);
  });

  // ── Keep status bar in sync with Shift+Tab cycles ──────────────────
  pi.on("thinking_level_select", (_event, ctx) => {
    setThinkingStatus(pi, ctx);
  });

  // ── Slash commands ─────────────────────────────────────────────────
  registerSlashCommands(pi, {
    permissions,
    spec,
    policyPromise: policyStatePromise,
    getDefaultTaskType: () => defaultTaskType,
  });

  // ── Keyboard shortcuts (appear in /hotkeys → Extensions) ───────────
  pi.registerShortcut("ctrl+shift+t", {
    description: "Select thinking level",
    handler: async (ctx) => {
      const model = ctx.model;
      if (!model) { ctx.ui.notify("No model active", "warning"); return; }
      if (!ctx.hasUI) { ctx.ui.notify("Thinking selector requires an interactive UI", "warning"); return; }
      const levels = getSupportedLevels(model);
      const options = levels.map((l) => THINKING_LABELS[l]);
      const selected = await ctx.ui.select("Select thinking level", options);
      if (!selected) return;
      const level = levels[options.indexOf(selected)];
      if (!level) return;
      pi.setThinkingLevel(level);
      setThinkingStatus(pi, ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+s", {
    description: "Show session snapshot: model, thinking, mode, spec, context, policy",
    handler: async (ctx) => {
      const policy = await requirePolicy(ctx);
      if (!policy) return;
      const theme = ctx.ui.theme;
      const model = ctx.model;
      const thinking = pi.getThinkingLevel() as ThinkingLevel | undefined;
      const usage = ctx.getContextUsage();
      const active = spec.activeSpec;

      const modelStr = model ? (model.name || model.id) : "none";
      const thinkingStr = thinking && thinking !== "off" ? thinking : "off";
      const modeStr = String(defaultTaskType ?? "explore (default)");

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
        yolo: permissions.isYolo,
      });
      ctx.ui.notify(panel, "info");
    },
  });

  pi.registerShortcut("ctrl+shift+e", {
    description: "Show current spec: goal, tier, criteria, verification state",
    handler: async (ctx) => {
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

  pi.registerShortcut("ctrl+shift+p", {
    description: "Show active policy: preset, rules, audit status",
    handler: async (ctx) => {
      const policy = await requirePolicy(ctx);
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
      const policy = await requirePolicy(ctx);
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
    description: "Run a code review — spawns reviewer, which delegates investigation to explore agents",
    handler: async (ctx) => {
      if (isSubagent) {
        ctx.ui.notify("Code review is only available in the main session.", "warning");
        return;
      }
      const goal = "Review the code changes in this session. Investigate any questions about the wider codebase by spawning explore agents. Report findings by severity and give an overall decision.";
      ctx.ui.notify("Starting code review…", "info");
      // Delegate to the reviewer agent via the task tool
      const policy = await requirePolicy(ctx);
      if (!policy) return;
      const { executeTask } = await import("./agents/task-tool");
      try {
        const result = await executeTask(
          { type: "reviewer", goal },
          undefined,
          undefined,
          policy,
        );
        try {
          const parsed = JSON.parse(result) as { text?: string; metadata?: { verdict?: string; findings?: unknown[] } };
          if (parsed.metadata) {
            const findingCount = Array.isArray(parsed.metadata.findings) ? parsed.metadata.findings.length : 0;
            ctx.ui.notify(`Review verdict: ${parsed.metadata.verdict ?? "unknown"}\nFindings: ${findingCount}`, "info");
          } else {
            ctx.ui.notify(result, "info");
          }
        } catch {
          ctx.ui.notify(result, "info");
        }
      } catch (err) {
        ctx.ui.notify(`Review failed: ${String(err)}`, "warning");
      }
    },
  });

  pi.registerShortcut("ctrl+shift+d", {
    description: "Spawn designer — UI/UX implementation and review",
    handler: async (ctx) => {
      if (isSubagent) {
        ctx.ui.notify("Designer is only available in the main session.", "warning");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("Pass a goal: use /task with type designer instead.", "warning");
        return;
      }
      const goal = await ctx.ui.select(
        "What should the designer do?",
        [
          "Implement UI changes — read the codebase, build components, cover all states",
          "Review UI code — check for accessibility gaps, missing states, AI slop patterns",
          "Audit design system — extract tokens, document inconsistencies, suggest consolidation",
        ],
      );
      if (!goal) return;
      ctx.ui.notify("Starting designer agent…", "info");
      const policy = await requirePolicy(ctx);
      if (!policy) return;
      const { executeTask } = await import("./agents/task-tool");
      try {
        const result = await executeTask(
          { type: "designer", goal },
          undefined,
          undefined,
          policy,
        );
        ctx.ui.notify(result, "info");
      } catch (err) {
        ctx.ui.notify(`Designer failed: ${String(err)}`, "warning");
      }
    },
  });

  pi.registerShortcut("ctrl+shift+y", {
    description: "Toggle yolo mode — bypass all permission checks",
    handler: async (ctx) => {
      const theme = ctx.ui.theme;
      if (!permissions.isYolo) {
        const ok = await ctx.ui.confirm(
          "Enable Yolo Mode?",
          "All permission checks, policy rules, and confirmation prompts will be bypassed.\n" +
          "The agent will execute any tool without asking. Use in trusted environments only.",
        );
        if (!ok) return;
        permissions.setYolo(true);
        ctx.ui.setStatus("harness-yolo", theme.fg("error", "⚡ yolo"));
        ctx.ui.notify(
          formatPanel(theme, "Yolo Mode ON", [
            theme.fg("warning", "All permission checks are now bypassed."),
            theme.fg("dim", "Press Ctrl+Shift+Y again to restore normal behavior."),
          ], "warning"),
          "warning",
        );
      } else {
        permissions.setYolo(false);
        ctx.ui.setStatus("harness-yolo", undefined);
        ctx.ui.notify(formatPanel(theme, "Yolo Mode OFF", "Permission checks restored.", "dim"), "info");
      }
    },
  });

  // ── MCP cleanup on shutdown ────────────────────────────────────────

  pi.on("session_shutdown", () => {
    mcpManager?.disconnect();
  });
  // ── Spec classification + session reset on each prompt ─────────────
  pi.on("before_agent_start", async (event, ctx) => {
    ctx.ui.setHeader(undefined);
    permissions.clearSessionRules();  // clear deny rules from any prior rejection
    spec.startTurn(event.prompt, pi.getFlag("spec") === true);


    // ── Memory: save corrections, inject preferences ───────────────
    const memoryPath = join(process.cwd(), ".harness", "memory.json");
    const project = process.cwd().split("/").pop() ?? "unknown";
    const store = MemoryStore.open(memoryPath);

    if (shouldSaveMemory(event.prompt)) {
      store.save({
        project,
        spec_tier: spec.activeSpec?.tier ?? "",
        capability: "",
        pattern: "",
        correction: extractCorrection(event.prompt),
      });
    }

    const memories = store.query({ project, limit: 10 });
    const injected = formatMemoriesForInjection(memories);

    // ── Model routing: switch for explicit specs, recommend for others ─
    const routingTier = spec.activeSpec?.tier ?? "ambient";
    const route = routeModel(routingTier);
    const currentModel = ctx.model;
    let modelSwitched = false;

    if (currentModel && routingTier === "explicit" && currentModel.id !== route.modelId) {
      const switched = await pi.setModel({
        ...currentModel,
        id: route.modelId,
        name: route.modelName,
        reasoning: route.reasoning,
        input: currentModel.input,
        cost: {
          input: route.inputCostPer1M,
          output: route.outputCostPer1M,
          cacheRead: route.cacheReadCostPer1M,
          cacheWrite: route.cacheWriteCostPer1M,
        },
        contextWindow: route.contextWindow,
        maxTokens: route.maxTokens,
      });
      modelSwitched = switched;
    }

    const theme = ctx.ui.theme ?? noopTheme;
    ctx.ui.setStatus("harness-route", theme.fg("dim", formatRouteStatus(route)));
    if (currentModel && currentModel.id !== route.modelId) {
      ctx.ui.notify(formatRouteNotice(routingTier, route, modelSwitched), "info");
    }

    return injected ? { systemPrompt: injected } : undefined;
  });

  // ── Permission + explicit-spec approval gate ───────────────────────
  pi.on("tool_call", async (event, ctx: ExtensionContext) => {
    const policyState = await policyStatePromise;
    if (policyState.kind === "error") {
      return { block: true, reason: `Policy configuration error: ${policyState.error}` };
    }
    const policy = policyState.policy;
    const promptUser = (msg: string) => ctx.ui.confirm("Permission Required", msg);
    const approveSpec = (s: FormalSpec) =>
      ctx.ui.confirm("Spec Approval Required", formatSpecForApproval(s, ctx.ui.theme ?? noopTheme));
    const auditLogger = policy.audit.enabled
      ? new AuditLogger(policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl"))
      : undefined;

    const handler = makeBeforeToolHandler(
      permissions,
      spec,
      promptUser,
      ctx.hasUI,
      approveSpec,
      policy,
      auditLogger,
    );
    const result = await handler(event);
    if (result?.block) return { block: true, reason: result.reason };

    if (!permissions.isYolo) {
      // Secret scanning: intercept writes/edits that contain credential patterns
      const { toolName, input } = event;
      if (toolName === "write" || toolName === "edit") {
        const raw = input as Record<string, unknown>;
        const content = String(raw["content"] ?? raw["new_string"] ?? "");
        if (content) {
          const scan = scanContent(content);
          if (scan.found) {
            const detail = formatScanResult(scan.matches);
            if (!ctx.hasUI) {
              return { block: true, reason: `Secret detected in ${toolName} — blocked in headless mode: ${scan.matches[0]?.type}` };
            }
            const proceed = await ctx.ui.confirm(
              "Secret Detected",
              `Potential credentials found:\n${detail}\n\nProceed anyway?`,
            );
            if (!proceed) {
              return { block: true, reason: `Secret detected — write blocked: ${scan.matches[0]?.type}` };
            }
          }
        }
      }

      // Git snapshot: stash working tree before critical (bash) tool calls
      if (classifyRisk(toolName, input) === "critical") {
        createSnapshot(process.cwd()).catch(() => {});
      }
    }
  });

  // ── Spec output collection ─────────────────────────────────────────
  pi.on("tool_result", async (event) => {
    const policyState = await policyStatePromise;
    const auditLogger = policyState.kind === "ok" && policyState.policy.audit.enabled
      ? new AuditLogger(policyState.policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl"))
      : undefined;
    await makeAfterToolHandler(spec, auditLogger, {
      sessionId: "unknown",
      agentType: isSubagent ? "subagent" : "parent",
    })(event);
  });

  pi.on("agent_end", async (event, ctx: ExtensionContext) => {
    const results = spec.finishTurn(event.messages);
    if (results.length === 0) return;
    const theme = ctx.ui.theme ?? noopTheme;
    const passed = results.filter((r) => r.passed).length;
    const lines = results.map((r) => `  ${r.passed ? theme.fg("success", "✓") : theme.fg("error", "✗")}  ${r.criterion.statement}`);
    const approvalNote =
      spec.activeSpec?.approvalStatus === "rejected"
        ? `\n${theme.fg("dim", "(spec was rejected)")}`
        : "";
    const hasFailures = passed !== results.length;
    const summaryHeader = !ctx.hasUI && hasFailures
      ? `${theme.bold(theme.fg("error", "Spec failed:"))}${approvalNote}`
      : `${theme.bold("Spec:")} ${theme.fg(hasFailures ? "warning" : "success", `${passed}/${results.length}`)} passed${approvalNote}`;
    
    const panel = formatPanel(theme, hasFailures ? "Spec Verification Failed" : "Spec Verification", lines, hasFailures ? "error" : "success");
    ctx.ui.notify(
      `${summaryHeader}\n${panel}`,
      hasFailures ? "warning" : "info",
    );
    ctx.ui.setStatus("harness-route", undefined);
  });

  // ── Web search tool ────────────────────────────────────────────────
  registerSearchTool(pi);

  if (!isSubagent) {
    pi.registerTool({
      name: "todo",
      label: "Manage todo state",
      description: "Track phased tasks with a single in-progress item and explicit export/import.",
      parameters: TodoParamsSchema,
      async execute(_toolCallId, params: TodoOperation) {
        try {
          if (params.op === "export") {
            return { content: [{ type: "text" as const, text: exportTodoMarkdown(todoState) }], details: undefined };
          }
          todoState = applyTodoOperation(todoState, params);
          return { content: [{ type: "text" as const, text: JSON.stringify(todoState) }], details: undefined };
        } catch (err) {
          return { content: [{ type: "text" as const, text: String(err) }], isError: true, details: undefined };
        }
      },
    });

    pi.registerTool({
      name: "ask",
      label: "Ask structured question",
      description: "Ask the user one typed, option-based question and return a governed decision record.",
      parameters: AskParamsSchema,
      async execute(_toolCallId, params: AskQuestion, _signal, _onUpdate, toolCtx) {
        try {
          const policyState = await policyStatePromise;
          if (policyState.kind === "error") {
            return { content: [{ type: "text" as const, text: `Policy configuration error: ${policyState.error}` }], isError: true, details: undefined };
          }
          const policy = policyState.policy;
          if (!toolCtx.hasUI) {
            const resolved = resolveHeadlessAsk(params, policy.preset);
            if (resolved.kind === "blocked") {
              return {
                content: [{ type: "text" as const, text: resolved.reason }],
                isError: true,
                details: undefined,
              };
            }
            const decision = buildAskDecision(params, resolved.selected, resolved.source);
            return { content: [{ type: "text" as const, text: JSON.stringify(decision) }], details: undefined };
          }

          const optionIds = params.options.map((option) => option.id);
          const selected = await toolCtx.ui.select(params.question, optionIds);
          if (!selected) {
            return { content: [{ type: "text" as const, text: "ask cancelled" }], isError: true, details: undefined };
          }
          const decision = buildAskDecision(params, [selected], "user");
          return { content: [{ type: "text" as const, text: JSON.stringify(decision) }], details: undefined };
        } catch (err) {
          return { content: [{ type: "text" as const, text: String(err) }], isError: true, details: undefined };
        }
      },
    });
  }

  if (isReviewer) {
    pi.registerTool({
      name: "report_finding",
      label: "Report review finding",
      description: "Record a structured review finding and return the aggregate review verdict.",
      parameters: FindingParamsSchema,
      async execute(_toolCallId, params, _signal, _onUpdate) {
        try {
          reviewFindings = addFinding(reviewFindings, params);
          return { content: [{ type: "text" as const, text: formatReviewSummary(reviewFindings) }], details: undefined };
        } catch (err) {
          return { content: [{ type: "text" as const, text: String(err) }], isError: true, details: undefined };
        }
      },
    });
  }

  // ── Task tool (main sessions + reviewer subagents) ────────────────
  // Reviewers get the task tool so they can spawn explore agents.
  // All other subagents are leaves and cannot spawn further.
  if (!isSubagent || isReviewer) {
    pi.registerTool({
      name: "task",
      label: isReviewer ? "Spawn explore agent" : "Delegate to specialist subagent",
      description: isReviewer
        ? "Spawn an explore agent to investigate a specific question about the codebase."
        : "Delegate a focused task to a specialist subagent. " +
          "Use explore to investigate, plan to design a solution, build to implement changes, reviewer to review code.",
      parameters: TaskParamsSchema,
      async execute(_toolCallId, params: TaskParams, signal, onUpdate, _ctx) {
        try {
          const policyState = await policyStatePromise;
          if (policyState.kind === "error") {
            return { content: [{ type: "text" as const, text: `Policy configuration error: ${policyState.error}` }], isError: true, details: undefined };
          }
          const policy = policyState.policy;
          const type = isReviewer
            ? "explore"
            : (params.type ?? defaultTaskType ?? await chooseTaskType(_ctx.hasUI, _ctx.ui));
          const resolvedParams = { ...params, type } as { type: NonNullable<TaskParams["type"]>; goal: string; context?: string };
          const result = await _executeTask(resolvedParams, signal, onUpdate as Parameters<typeof _executeTask>[2], policy);
          return { content: [{ type: "text" as const, text: result }], details: undefined };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: String(err) }],
            isError: true,
            details: undefined,
          };
        }
      },
    });
  }
}
