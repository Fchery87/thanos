import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MCPManager } from "../../mcp/manager";
import type { PolicyLoadState } from "../../policy/state";
import { checkPatchDrift, formatPatchDriftWarning } from "../../welcome/patch-drift";
import { formatPanel } from "../../ui-utils";
import { buildToolContractSnapshot } from "../../governance/tool-contract";
import type { DeliveryRuntime } from "./delivery";

export interface DoctorCommandDeps {
  isSubagent: boolean;
  policyStatePromise: Promise<PolicyLoadState>;
  mcpManager: MCPManager | null;
  deliveryRuntime: DeliveryRuntime;
}

type Level = "ok" | "warn" | "bad";

interface Check {
  name: string;
  level: Level;
  detail: string;
}

/**
 * /doctor — one place to see whether the harness's configuration still matches
 * what you think it is.
 *
 * Every check here already ran somewhere: patch drift and the policy load are
 * startup notifications, MCP status lives in `/mcp`, delivery mode in
 * `/delivery`. The problem is that each announces itself once, at launch, in a
 * stream you scroll past — and every one of them fails *quietly*. A reverted
 * pi-subagents patch, a policy file that stopped parsing, an MCP server the
 * trust gate refused: none of those interrupt you, and all of them change what
 * the harness does.
 *
 * Deliberately reports only what it can establish from state the harness
 * already holds. No new subsystem, no network beyond what the checks already
 * do, and nothing that needs a live turn.
 */
export function registerDoctorCommand(pi: ExtensionAPI, deps: DoctorCommandDeps): void {
  const { isSubagent, policyStatePromise, mcpManager, deliveryRuntime } = deps;

  pi.registerCommand("doctor", {
    description: "Check harness health: policy, MCP servers, delivery mode, and pi-subagents patch drift.",
    handler: async (_args, ctx) => {
      if (isSubagent) {
        ctx.ui.notify("/doctor is only available in the main session.", "warning");
        return;
      }
      const theme = ctx.ui.theme;
      const checks: Check[] = [];

      // ── Policy ──────────────────────────────────────────────────────────
      // A policy that fails to parse blocks every governed tool call, so this
      // is the one whose failure is loudest in practice and least obvious in
      // cause.
      const policyState = await policyStatePromise;
      checks.push(policyState.kind === "ok"
        ? {
            name: "policy",
            level: "ok",
            detail: `preset ${policyState.policy.preset}, ${policyState.policy.rules.length} rule(s), audit ${policyState.policy.audit.enabled ? "on" : "off"}`,
          }
        : { name: "policy", level: "bad", detail: policyState.error });

      // ── MCP ─────────────────────────────────────────────────────────────
      // `blocked` is separated from `error` on purpose: a blocked server is not
      // broken, it is refused by the trust gate and is waiting on a decision
      // (/mcp → trust). Rolling it into "failed" would send you debugging a
      // server that is working exactly as designed.
      const statuses = mcpManager?.getStatuses() ?? [];
      if (statuses.length === 0) {
        checks.push({ name: "mcp", level: "ok", detail: "no servers configured" });
      } else {
        const connected = statuses.filter((s) => s.connected);
        const blocked = statuses.filter((s) => s.blocked);
        const failed = statuses.filter((s) => s.error && !s.blocked);
        const disabled = statuses.filter((s) => s.disabled);
        const parts = [`${connected.length}/${statuses.length} connected`];
        if (disabled.length > 0) parts.push(`${disabled.length} disabled`);
        if (blocked.length > 0) parts.push(`${blocked.length} untrusted (/mcp → trust): ${blocked.map((s) => s.name).join(", ")}`);
        if (failed.length > 0) parts.push(`${failed.length} failed: ${failed.map((s) => s.name).join(", ")}`);
        checks.push({
          name: "mcp",
          level: failed.length > 0 ? "bad" : blocked.length > 0 ? "warn" : "ok",
          detail: parts.join(" · "),
        });
      }

      // ── Delivery ────────────────────────────────────────────────────────
      // An unregistered repo silently resolves to the safe default, which is
      // correct but worth being able to see rather than infer.
      const delivery = await deliveryRuntime.getState();
      checks.push(delivery
        ? {
            name: "delivery",
            level: delivery.registered ? "ok" : "warn",
            detail: delivery.registered
              ? DeliveryRuntimeLabel(delivery)
              : `${DeliveryRuntimeLabel(delivery)} — repo not registered, using the safe default (/delivery to register)`,
          }
        : { name: "delivery", level: "warn", detail: "no delivery state resolved" });

      // ── Tool contract ───────────────────────────────────────────────────
      // Same projection /tools and docs/reference.md use — a mismatch here
      // would mean runtime classification and the diagnostic view disagree.
      // pi.getAllTools()/getActiveTools() are live registry reads, not a
      // probe: no server start, network call, model call, or mutation.
      const toolSnapshot = buildToolContractSnapshot({
        tools: pi.getAllTools(),
        activeToolNames: pi.getActiveTools(),
      });
      checks.push({
        name: "tools",
        level: toolSnapshot.summary.unknown > 0 ? "warn" : "ok",
        detail: `${toolSnapshot.summary.active} active, ${toolSnapshot.summary.recognized} recognized, ${toolSnapshot.summary.unknown} unknown (rev ${toolSnapshot.revision.slice(0, 15)})`,
      });

      // ── pi-subagents patch drift ────────────────────────────────────────
      // A package update silently reverts the Thanos source patches, and the
      // first symptom is a fanout crash on a reviewer run.
      try {
        const drift = await checkPatchDrift();
        const warning = formatPatchDriftWarning(drift);
        checks.push(warning
          ? { name: "subagents", level: "warn", detail: warning.replace(/\s+/g, " ").trim() }
          : { name: "subagents", level: "ok", detail: "pi-subagents patches intact" });
      } catch (err) {
        checks.push({ name: "subagents", level: "warn", detail: `patch check failed: ${err instanceof Error ? err.message : String(err)}` });
      }

      const icon = (level: Level) => level === "ok"
        ? theme.fg("success", "✓")
        : level === "warn" ? theme.fg("warning", "!") : theme.fg("error", "✗");

      const lines = checks.map((c) => `  ${icon(c.level)} ${theme.fg("accent", c.name.padEnd(10))} ${theme.fg("dim", c.detail)}`);
      const worst: Level = checks.some((c) => c.level === "bad")
        ? "bad"
        : checks.some((c) => c.level === "warn") ? "warn" : "ok";

      ctx.ui.notify(
        formatPanel(theme, "Harness Health", lines, worst === "bad" ? "error" : worst === "warn" ? "warning" : "success"),
        worst === "ok" ? "info" : "warning",
      );
    },
  });
}

/** Local copy of the delivery label so /doctor does not depend on class statics. */
function DeliveryRuntimeLabel(state: { mode: string; autonomy?: string }): string {
  return state.autonomy ? `${state.mode} · ${state.autonomy}` : state.mode;
}
