import { appendHarnessEvent, HARNESS_EVENT_SCHEMA_VERSION } from "../observability/harness-ledger";

/**
 * Why a turn's semantic extraction ended the way it did.
 *
 * Semantic extraction shipped on 2026-07-27, ran 48 times, produced nothing, and
 * reported nothing — because every failure path in `ContractExtractor.extract`
 * returned `undefined` and the whole body sat inside `catch { return undefined; }`.
 * The deterministic contract stood in each time, so the harness looked like it
 * was working. Fail-safe without a record is indistinguishable from fail-silent.
 *
 * These outcomes are the denominator for Phase 3's decision: the fraction of
 * attempts ending in `accepted` decides whether `src/spec/` is kept or deleted.
 */
export type ExtractionOutcome =
  // ── the extractor's own paths ──
  /** Turned off in settings, or an instant-tier prompt that is never extracted. */
  | "disabled"
  /** No ExtensionContext yet — before_agent_start has not handed one over. */
  | "no_context"
  /** Neither a routed evaluator model nor a session model was resolvable. */
  | "no_model"
  /** The model registry could not produce auth for the chosen model. */
  | "auth_failed"
  /** The provider did not answer inside the configured budget. */
  | "timeout"
  /** The provider answered with stopReason error/aborted. */
  | "provider_error"
  /** The response held no JSON object this could parse. */
  | "unparseable"
  /** Anything else thrown inside extract(). */
  | "threw"
  // ── the engine's paths, after a candidate comes back ──
  /** Parsed, but `validateTaskContract` refused it. */
  | "schema_rejected"
  /** Valid shape, empty objective — settleContract discards these. */
  | "empty_objective"
  /** A newer turn replaced the spec while this extraction was in flight. */
  | "stale"
  /** Folded into the active spec. The only outcome that counts as a success. */
  | "accepted";

export interface ExtractionReport {
  outcome: ExtractionOutcome;
  /**
   * Short, non-sensitive context — an error class, a criterion count, the field
   * that failed validation. Never the user's prompt: this file lands in the
   * repo's ledger, and the request that produced it is not ours to persist.
   */
  detail?: string;
  criteriaCount?: number;
}

export type ExtractionReporter = (report: ExtractionReport) => void;

/** Reports nothing. The default everywhere except the live harness. */
export const noopExtractionReporter: ExtractionReporter = () => {};

/**
 * Append to the harness ledger, fire-and-forget.
 *
 * Never awaited and never allowed to throw: observing a failure must not become
 * a second way for the turn to fail. A lost log line is strictly better than a
 * broken turn.
 */
export function createLedgerExtractionReporter(
  taskId: string,
  cwd = process.cwd(),
  /**
   * The extractor's configured timeout budget, if known at construction time.
   * Recorded as a structured field on every row (not just `timeout`-outcome
   * ones) so a future reader never has to parse it back out of `detail`.
   */
  effectiveTimeoutMs?: number,
): ExtractionReporter {
  return (report) => {
    const evidence = [report.detail, report.criteriaCount === undefined ? undefined : `criteria=${report.criteriaCount}`]
      .filter((item): item is string => Boolean(item));
    void appendHarnessEvent({
      type: "spec_extraction",
      taskId,
      summary: `semantic extraction: ${report.outcome}`,
      ...(evidence.length > 0 ? { evidence } : {}),
      outcome: report.outcome === "accepted" ? "ok" : "fell_back",
      createdAt: new Date().toISOString(),
      schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
      repository: cwd,
      ...(effectiveTimeoutMs === undefined ? {} : { timeoutMs: effectiveTimeoutMs }),
    }, cwd).catch(() => {});
  };
}
