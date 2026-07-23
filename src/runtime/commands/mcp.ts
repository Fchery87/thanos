import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MCPManager } from "../../mcp/manager";
import { loadMcpConfigs, mcpConfigPaths } from "../../mcp/config";
import { writeServerSecrets, readServerSecrets } from "../../mcp/state";
import { runOAuthFlow, probeOAuth, fetchOAuthMeta } from "../../mcp/oauth";
import {
  connectMcpServer,
  disableMcpServer,
  disconnectMcpServer,
  enableMcpServer,
  reloadMcpSession,
} from "../../mcp/lifecycle";
import {
  DEFAULT_PICKER_LABEL_WIDTH,
  fitTerminalText,
  formatLabel,
  formatPanel,
  makeTerminalSafeOptions,
} from "../../ui-utils";

export interface McpCommandDeps {
  isSubagent: boolean;
  mcpManager: MCPManager | null;
}

/** /mcp — MCP server lifecycle management: list, enable, disable, auth, connect, reload… */
export function registerMcpCommand(pi: ExtensionAPI, deps: McpCommandDeps): void {
  const { isSubagent, mcpManager } = deps;

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
            fitTerminalText(`Set env var for ${name} — KEY`, DEFAULT_PICKER_LABEL_WIDTH),
            hintStr ? `Existing: ${hintStr}` : "e.g. OPENAI_API_KEY",
          );
          if (!key?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
          const val = await ctx.ui.input(
            fitTerminalText(`Set env var for ${name} — VALUE for ${key.trim()}`, DEFAULT_PICKER_LABEL_WIDTH),
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
              const { accessToken, refreshToken } = await runOAuthFlow(config.url);
              const oauthMeta = await fetchOAuthMeta(config.url);
              await writeServerSecrets(name, {
                headers: { Authorization: `Bearer ${accessToken}` },
                oauth: {
                  refreshToken,
                  tokenEndpoint: oauthMeta?.token_endpoint,
                  clientId: "pi-harness",
                },
              });
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
            const header = await ctx.ui.input(fitTerminalText(`Set header for ${name} — Header name`, DEFAULT_PICKER_LABEL_WIDTH), hintStr ? `Existing: ${hintStr}` : "e.g. Authorization");
            if (!header?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
            const val = await ctx.ui.input(fitTerminalText(`Set header for ${name} — Value for ${header.trim()}`, DEFAULT_PICKER_LABEL_WIDTH), "e.g. Bearer sk-…");
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
        const optionDetails = statuses.map((s) => {
          if (s.disabled) return `○  ${s.name}  [${s.source}]  disabled`;
          const icon   = s.error ? "✗" : "✓";
          const detail = s.error ? `error` : `${s.toolCount} tools`;
          return `${icon}  ${s.name}  [${s.source}]  ${detail}`;
        });
        const options = makeTerminalSafeOptions(optionDetails);

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

        const action = await ctx.ui.select(fitTerminalText(`Action for: ${sName}`, DEFAULT_PICKER_LABEL_WIDTH), actions);
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
            const key = await ctx.ui.input(fitTerminalText(`Env var KEY for ${sName}`, DEFAULT_PICKER_LABEL_WIDTH), hintStr ? `Existing: ${hintStr}` : "e.g. OPENAI_API_KEY");
            if (!key?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
            const val = await ctx.ui.input(fitTerminalText(`Value for ${key.trim()}`, DEFAULT_PICKER_LABEL_WIDTH), "(hidden after saving)");
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
                const { accessToken, refreshToken } = await runOAuthFlow(config.url);
                const oauthMeta = await fetchOAuthMeta(config.url);
                await writeServerSecrets(sName, {
                  headers: { Authorization: `Bearer ${accessToken}` },
                  oauth: {
                    refreshToken,
                    tokenEndpoint: oauthMeta?.token_endpoint,
                    clientId: "pi-harness",
                  },
                });
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
              const header = await ctx.ui.input(fitTerminalText(`Header name for ${sName}`, DEFAULT_PICKER_LABEL_WIDTH), hintStr ? `Existing: ${hintStr}` : "e.g. Authorization");
              if (!header?.trim()) { ctx.ui.notify("Auth cancelled.", "info"); return; }
              const val = await ctx.ui.input(fitTerminalText(`Value for ${header.trim()}`, DEFAULT_PICKER_LABEL_WIDTH), "e.g. Bearer sk-…");
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
}
