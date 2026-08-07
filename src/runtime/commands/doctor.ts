import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MCPManager, ServerStatus } from "../../mcp/manager";
import type { PolicyLoadState } from "../../policy/state";
import { checkPatchDrift as defaultCheckPatchDrift, formatPatchDriftWarning, type PatchDriftResult } from "../../welcome/patch-drift";
import { checkPinDrift as defaultCheckPinDrift, formatUnpinnedPinWarning } from "../../welcome/pin-assertion";
import type { TUITheme } from "../../ui-utils";
import { formatPanel } from "../../ui-utils";
import { buildToolContractSnapshot, type ToolContractSnapshot } from "../../governance/tool-contract";
import type { SpecExtractionSettings } from "../../spec/extractor";
import type { GoalController } from "../../goal/controller";
import type { SpecEngine } from "../../spec/engine";
import type { WorkflowRuntime } from "../../workflows/state";
import type { DeliveryRuntime } from "./delivery";

export interface DoctorCommandDeps {
  isSubagent: boolean;
  policyStatePromise: Promise<PolicyLoadState>;
  mcpManager: MCPManager | null;
  deliveryRuntime: DeliveryRuntime;
  goalController: GoalController;
  spec: SpecEngine;
  workflowRuntime: WorkflowRuntime;
  /**
   * The extraction settings actually in effect for this session — the same
   * snapshot `register-harness.ts` already loaded once at startup and bound
   * into `ContractExtractor`/`createLedgerExtractionReporter`. Re-reading
   * `loadSpecSettings()` live here would let /doctor report a value that
   * disagrees with what the running extractor and ledger rows actually use
   * if `settings.json` changes mid-session.
   */
  specSettings: SpecExtractionSettings;
  /** Injectable for tests; defaults to the real check (reads pi-subagents' installed source under $HOME). */
  checkPatchDrift?: () => Promise<PatchDriftResult>;
  /** Injectable for tests; defaults to the real check (reads agent/settings.json's `packages` spec). */
  checkPinDrift?: () => Promise<string | undefined>;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * A structured health finding, testable independently of terminal rendering.
 * `code` is the stable, machine-checkable identity of a finding — tests
 * assert on it rather than on rendered text, so `renderDoctorDiagnostics`
 * can change wording freely without breaking coverage.
 */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  subsystem: string;
  source?: string;
  message: string;
  remediation?: string;
}

/** Already-resolved data `collectDoctorDiagnostics` needs — no promises, no live objects with side effects. */
export interface DoctorInputs {
  policy: PolicyLoadState;
  mcpStatuses: readonly ServerStatus[];
  delivery: { registered: boolean; mode: string; autonomy?: string } | undefined;
  patchDrift: { warning?: string; error?: string };
  pinDrift: { warning?: string; error?: string };
  toolContract: ToolContractSnapshot;
  goalStatus: "active" | "paused" | "achieved" | "none";
  workflowPhase: string | undefined;
  specActive: boolean;
  extraction: { enabled: boolean; timeoutMs: number };
}

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { info: 0, warning: 1, error: 2 };

/** The most severe level across all diagnostics — a healthy check can never downgrade an error found elsewhere. */
export function worstSeverity(diagnostics: readonly Diagnostic[]): DiagnosticSeverity {
  return diagnostics.reduce<DiagnosticSeverity>(
    (worst, d) => (SEVERITY_RANK[d.severity] > SEVERITY_RANK[worst] ? d.severity : worst),
    "info",
  );
}

/**
 * Pure, synchronous, and read-only: no model, network, filesystem, or MCP
 * call, and no mutation of policy/permissions/delivery/acceptance state.
 * Check order is fixed so two runs over identical inputs always render
 * identically.
 */
export function collectDoctorDiagnostics(inputs: DoctorInputs): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // ── Policy ──────────────────────────────────────────────────────────
  // A policy that fails to parse blocks every governed tool call, so this
  // is the one whose failure is loudest in practice and least obvious in
  // cause.
  diagnostics.push(inputs.policy.kind === "ok"
    ? {
        severity: "info",
        code: "policy.ok",
        subsystem: "policy",
        message: `preset ${inputs.policy.policy.preset}, ${inputs.policy.policy.rules.length} rule(s), audit ${inputs.policy.policy.audit.enabled ? "on" : "off"}`,
      }
    : {
        severity: "error",
        code: "policy.error",
        subsystem: "policy",
        message: inputs.policy.error,
        remediation: "Fix the policy file's syntax, then restart the session.",
      });

  // ── MCP ─────────────────────────────────────────────────────────────
  // `blocked` is kept a distinct code from `failed`: a blocked server is not
  // broken, it is refused by the trust gate and is waiting on a decision
  // (/mcp → trust). Folding it into "failed" would send you debugging a
  // server that is working exactly as designed.
  if (inputs.mcpStatuses.length === 0) {
    diagnostics.push({ severity: "info", code: "mcp.none", subsystem: "mcp", message: "no servers configured" });
  } else {
    const connected = inputs.mcpStatuses.filter((s) => s.connected);
    const blocked = inputs.mcpStatuses.filter((s) => s.blocked);
    const failed = inputs.mcpStatuses.filter((s) => s.error && !s.blocked);
    const disabled = inputs.mcpStatuses.filter((s) => s.disabled);
    const parts = [`${connected.length}/${inputs.mcpStatuses.length} connected`];
    if (disabled.length > 0) parts.push(`${disabled.length} disabled`);
    if (blocked.length > 0) parts.push(`${blocked.length} untrusted: ${blocked.map((s) => s.name).join(", ")}`);
    if (failed.length > 0) parts.push(`${failed.length} failed: ${failed.map((s) => s.name).join(", ")}`);

    diagnostics.push(failed.length > 0
      ? { severity: "error", code: "mcp.failed", subsystem: "mcp", message: parts.join(" · "), remediation: "Check server logs; failing servers do not block other tool calls." }
      : blocked.length > 0
        ? { severity: "warning", code: "mcp.blocked", subsystem: "mcp", message: parts.join(" · "), remediation: "/mcp → trust to approve, or leave untrusted." }
        : { severity: "info", code: "mcp.connected", subsystem: "mcp", message: parts.join(" · ") });
  }

  // ── Delivery ────────────────────────────────────────────────────────
  // An unregistered repo silently resolves to the safe default, which is
  // correct but worth being able to see rather than infer.
  diagnostics.push(inputs.delivery
    ? {
        severity: inputs.delivery.registered ? "info" : "warning",
        code: inputs.delivery.registered ? "delivery.registered" : "delivery.unregistered",
        subsystem: "delivery",
        message: deliveryLabel(inputs.delivery),
        remediation: inputs.delivery.registered ? undefined : "/delivery to register this repo explicitly.",
      }
    : { severity: "warning", code: "delivery.unresolved", subsystem: "delivery", message: "no delivery state resolved" });

  // ── Tool contract ───────────────────────────────────────────────────
  // Same projection /tools and docs/reference.md use — a mismatch there
  // would mean runtime classification and this diagnostic view disagree.
  const tc = inputs.toolContract.summary;
  diagnostics.push({
    severity: tc.unknown > 0 ? "warning" : "info",
    code: tc.unknown > 0 ? "tools.unknown_present" : "tools.ok",
    subsystem: "tools",
    source: `rev ${inputs.toolContract.revision.slice(0, 15)}`,
    message: `${tc.active} active, ${tc.recognized} recognized, ${tc.unknown} unknown`,
  });

  // ── Active state (goal / workflow / spec) ──────────────────────────
  // Read-only session-state summary: what's currently driving continuation.
  const stateParts = [
    `goal ${inputs.goalStatus}`,
    `workflow ${inputs.workflowPhase ?? "none"}`,
    `spec ${inputs.specActive ? "active" : "none"}`,
  ];
  diagnostics.push({ severity: "info", code: "state.summary", subsystem: "state", message: stateParts.join(" · ") });

  // ── Extraction settings ─────────────────────────────────────────────
  // Config only — the keep/delete question itself is decided by
  // src/spec/extractor-decision.ts against the ledger, not here.
  diagnostics.push({
    severity: "info",
    code: inputs.extraction.enabled ? "extraction.enabled" : "extraction.disabled",
    subsystem: "extraction",
    message: inputs.extraction.enabled
      ? `enabled, ${inputs.extraction.timeoutMs}ms timeout`
      : "disabled in settings.json",
  });

  // ── pi-subagents patch drift ────────────────────────────────────────
  // A package update silently reverts the Thanos source patches, and the
  // first symptom is a fanout crash on a review-critic run.
  diagnostics.push(inputs.patchDrift.error
    ? { severity: "warning", code: "subagents.patch_check_failed", subsystem: "subagents", message: `patch check failed: ${inputs.patchDrift.error}` }
    : inputs.patchDrift.warning
      ? { severity: "warning", code: "subagents.patch_drift", subsystem: "subagents", message: inputs.patchDrift.warning.replace(/\s+/g, " ").trim() }
      : { severity: "info", code: "subagents.patch_ok", subsystem: "subagents", message: "pi-subagents patches intact" });

  // ── pi-subagents pin drift ─────────────────────────────────────────
  // An unpinned spec in agent/settings.json silently resolves to @latest on
  // the next `pi update --extensions`, which is exactly the condition the
  // patch check above cannot self-heal across.
  diagnostics.push(inputs.pinDrift.error
    ? { severity: "warning", code: "subagents.pin_check_failed", subsystem: "subagents", message: `pin check failed: ${inputs.pinDrift.error}` }
    : inputs.pinDrift.warning
      ? { severity: "warning", code: "subagents.pin_drift", subsystem: "subagents", message: inputs.pinDrift.warning.replace(/\s+/g, " ").trim() }
      : { severity: "info", code: "subagents.pin_ok", subsystem: "subagents", message: "pi-subagents pin exact" });

  return diagnostics;
}

function deliveryLabel(state: { mode: string; autonomy?: string; registered: boolean }): string {
  const label = state.autonomy ? `${state.mode} · ${state.autonomy}` : state.mode;
  return state.registered ? label : `${label} — repo not registered, using the safe default`;
}

const SEVERITY_ICON: Record<DiagnosticSeverity, (theme: TUITheme, glyph: string) => string> = {
  info: (theme, glyph) => theme.fg("success", glyph),
  warning: (theme, glyph) => theme.fg("warning", glyph),
  error: (theme, glyph) => theme.fg("error", glyph),
};
const SEVERITY_GLYPH: Record<DiagnosticSeverity, string> = { info: "✓", warning: "!", error: "✗" };

export function renderDoctorDiagnostics(diagnostics: readonly Diagnostic[], theme: TUITheme): string {
  const lines = diagnostics.flatMap((d) => {
    const sourceLabel = d.source ? theme.fg("dim", ` (${d.source})`) : "";
    const line = `  ${SEVERITY_ICON[d.severity](theme, SEVERITY_GLYPH[d.severity])} ${theme.fg("accent", d.subsystem.padEnd(10))} ${theme.fg("dim", d.message)}${sourceLabel}`;
    if (!d.remediation) return [line];
    return [line, `      ${theme.fg("dim", "→")} ${theme.fg("dim", d.remediation)}`];
  });
  const worst = worstSeverity(diagnostics);
  return formatPanel(theme, "Harness Health", lines, worst === "error" ? "error" : worst === "warning" ? "warning" : "success");
}

/**
 * /doctor — one place to see whether the harness's configuration still matches
 * what you think it is.
 *
 * Every check here already ran somewhere: patch drift and the policy load are
 * startup notifications, MCP status lives in `/mcp`, delivery mode in
 * `/delivery`, tool classification in `/tools`. The problem is that each
 * announces itself once, at launch, in a stream you scroll past — and every
 * one of them fails *quietly*.
 *
 * Deliberately reports only what it can establish from state the harness
 * already holds. No new subsystem, no network beyond what the checks already
 * do, no model call, no mutation, and nothing that needs a live turn.
 */
export function registerDoctorCommand(pi: ExtensionAPI, deps: DoctorCommandDeps): void {
  const {
    isSubagent, policyStatePromise, mcpManager, deliveryRuntime, goalController, spec, workflowRuntime,
    specSettings, checkPatchDrift = defaultCheckPatchDrift, checkPinDrift = defaultCheckPinDrift,
  } = deps;

  pi.registerCommand("doctor", {
    description: "Check harness health: policy, MCP servers, delivery mode, tools, active state, and pi-subagents patch drift.",
    handler: async (_args, ctx) => {
      if (isSubagent) {
        ctx.ui.notify("/doctor is only available in the main session.", "warning");
        return;
      }
      const theme = ctx.ui.theme;

      const policy = await policyStatePromise;
      const delivery = await deliveryRuntime.getState();
      let patchDrift: DoctorInputs["patchDrift"] = {};
      try {
        const drift = await checkPatchDrift();
        const warning = formatPatchDriftWarning(drift);
        if (warning) patchDrift = { warning };
      } catch (err) {
        patchDrift = { error: err instanceof Error ? err.message : String(err) };
      }

      let pinDrift: DoctorInputs["pinDrift"] = {};
      try {
        const spec = await checkPinDrift();
        if (spec) pinDrift = { warning: formatUnpinnedPinWarning(spec) };
      } catch (err) {
        pinDrift = { error: err instanceof Error ? err.message : String(err) };
      }

      const goalSnapshot = goalController.snapshot();
      const inputs: DoctorInputs = {
        policy,
        mcpStatuses: mcpManager?.getStatuses() ?? [],
        delivery,
        patchDrift,
        pinDrift,
        toolContract: buildToolContractSnapshot({ tools: pi.getAllTools(), activeToolNames: pi.getActiveTools() }),
        goalStatus: goalSnapshot?.status ?? "none",
        workflowPhase: workflowRuntime.current?.phase,
        specActive: spec.activeSpec !== undefined,
        extraction: { enabled: specSettings.extraction, timeoutMs: specSettings.timeoutMs },
      };

      const diagnostics = collectDoctorDiagnostics(inputs);
      const worst = worstSeverity(diagnostics);
      ctx.ui.notify(renderDoctorDiagnostics(diagnostics, theme), worst);
    },
  });
}
