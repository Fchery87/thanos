import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { PermissionManager } from "../permissions/manager";
import type { PolicyLoadState } from "../policy/state";
import type { LensLite } from "../lens/lite";
import type { MCPManager } from "../mcp/manager";
import { initializeMcpSession } from "../mcp/lifecycle";
import { readRepoId } from "../governance/delivery";
import type { TaskParams } from "../agents/task-tool";
import { renderWelcomeHeader, formatTimeAgo, type WelcomeMcpSummary, type WelcomePolicySummary } from "../welcome/header";
import { checkForUpdate } from "../welcome/update-check";
import { checkPatchDrift, formatPatchDriftWarning } from "../welcome/patch-drift";
import { formatPanel } from "../ui-utils";
import { DeliveryRuntime } from "./commands/delivery";
import type { TodoRuntime } from "./commands/todo";

export interface SessionStartDeps {
  todoRuntime: TodoRuntime;
  mcpManager: MCPManager | null;
  deliveryRuntime: DeliveryRuntime;
  permissions: PermissionManager;
  lens: LensLite;
  policyStatePromise: Promise<PolicyLoadState>;
  getDefaultTaskType: () => TaskParams["type"] | undefined;
  clearReviewFindings: () => void;
}

/**
 * session_start (welcome header, MCP init, first-launch delivery selector,
 * status-bar segments), session_tree (todo state re-sync on branch switch),
 * and session_shutdown (MCP disconnect — the natural counterpart to the MCP
 * init this module already owns). All three share mcpManager/todoRuntime
 * state, so extracted together.
 */
export function registerSessionStart(pi: ExtensionAPI, deps: SessionStartDeps): void {
  const { todoRuntime, mcpManager, deliveryRuntime, permissions, lens, policyStatePromise, getDefaultTaskType, clearReviewFindings } = deps;

  pi.on("session_start", async (event, ctx) => {
    clearReviewFindings();
    todoRuntime.reconstructFrom(ctx.sessionManager.getBranch());
    ctx.ui.setStatus("harness-todo", todoRuntime.statusSegment(ctx));
    if (!mcpManager) return;

    const theme = ctx.ui.theme;

    // session_start is parent-only (the `if (!mcpManager) return` guard above).
    // If the registry locks yolo, enforce it here too — idempotent with the
    // env-based lock applied at construction.
    const delivery = await deliveryRuntime.getState();
    if (delivery?.yoloLocked) permissions.lockYolo();

    // Show yolo/lens status if default-on
    if (permissions.isYolo) {
      ctx.ui.setStatus("harness-yolo", theme.fg("error", "⚡ yolo"));
    }
    lens.setStatus(ctx);

    // Delivery mode status segment (autonomy shown only when unattended).
    if (delivery) {
      ctx.ui.setStatus("harness-delivery", theme.fg("accent", DeliveryRuntime.statusLabel(delivery)));
    }

    // ── First-launch delivery selector ─────────────────────────────────
    // An unregistered repo resolves to the safe default (local-only/attended).
    // When a human is present, offer to register it in the trusted captain
    // registry — the interactive counterpart of hand-editing projects.json.
    // Every non-interactive path (ESC, no UI, subagent — excluded above by the
    // mcpManager guard) keeps the fail-closed default untouched.
    if (delivery && !delivery.registered && ctx.hasUI) {
      try {
        const repoId = await readRepoId(process.cwd());
        const mode = await deliveryRuntime.promptMode(ctx, repoId.remote ?? repoId.path);
        if (mode) {
          await deliveryRuntime.applySelection(ctx, mode, permissions);
        } else {
          ctx.ui.notify(
            "Keeping the safe default (local-only). Run /delivery to register this project later.",
            "info",
          );
        }
      } catch (err) {
        ctx.ui.notify(
          `Delivery selector failed: ${err instanceof Error ? err.message : String(err)}`,
          "warning",
        );
      }
    }

    let mcpSummary: WelcomeMcpSummary = { configured: 0, connected: 0, failed: 0, initFailed: false };

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
        modeStr: String(getDefaultTaskType() ?? "explore (default)"),
        mcp: mcpSummary,
        policy,
        recentRows,
      }));

      // Non-blocking release check (cached 24h). Failure is silent — an
      // offline session should never see noise from this.
      checkForUpdate().then((update) => {
        if (update?.updateAvailable) {
          ctx.ui.notify(
            `Thanos ${update.latest} is available (you have v${update.current}) — run 'thanos update' to upgrade.`,
            "info",
          );
        }
      }).catch(() => {});

      // Non-blocking pi-subagents patch-drift check. A package update can
      // silently revert the two Thanos source patches (see
      // scripts/patch-pi-subagents.mjs), and the first symptom is the fanout
      // double-registration crash resurfacing unexplained on a reviewer run.
      // Silent when pi-subagents isn't installed or both patches are intact.
      checkPatchDrift().then((result) => {
        const warning = formatPatchDriftWarning(result);
        if (warning) ctx.ui.notify(warning, "warning");
      }).catch(() => {});
    }

    initializeMcpSession({ manager: mcpManager, pi, cwd: ctx.cwd }).then((init) => {
      mcpSummary = {
        configured: init.statuses.length,
        connected: init.connectedCount,
        failed: init.statuses.filter((s) => s.error).length,
        initFailed: init.kind === "failed",
      };
      if (init.kind === "failed") {
        ctx.ui.notify(`MCP init failed: ${init.error}`, "warning");
        return;
      }
      const connected = init.statuses.filter((s) => !s.error);
      const failed = init.statuses.filter((s) => s.error);
      if (connected.length > 0) {
        ctx.ui.setStatus("harness-mcp", theme.fg("accent", `mcp:${connected.length}`));
      }
      if (failed.length > 0) {
        const summary = failed.map((s) => `${theme.fg("error", s.name)}: ${s.error}`).join("\n  ");
        ctx.ui.notify(formatPanel(theme, "MCP Failed", summary, "error"), "warning");
      }
    }).catch((err) => {
      ctx.ui.notify(`MCP init failed: ${err instanceof Error ? err.message : String(err)}`, "warning");
    });
  });

  pi.on("session_tree", async (_event, ctx) => {
    todoRuntime.reconstructFrom(ctx.sessionManager.getBranch());
    ctx.ui.setStatus("harness-todo", todoRuntime.statusSegment(ctx));
  });

  // ── MCP cleanup on shutdown ────────────────────────────────────────
  pi.on("session_shutdown", () => {
    mcpManager?.disconnect();
  });
}
