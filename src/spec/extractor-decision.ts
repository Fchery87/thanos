import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { ExtractionOutcome } from "./extraction-log";
import { HARNESS_EVENT_SCHEMA_VERSION } from "../observability/harness-ledger";

/**
 * Whether `src/spec/`'s ambient model call earns its keep is decided from the
 * fraction of attempts that reach `accepted`, out of the outcomes where a model
 * actually answered. `disabled`, `no_context`, `no_model`, `auth_failed`,
 * `timeout`, `provider_error`, `threw`, and `stale` are facts about config,
 * credentials, budget, or a bug — not about whether a model can write a
 * contract — and are excluded from the denominator for that reason (see
 * `docs/plans/2026-07-27-harness-simplification-plan.md`).
 */
export const QUALIFYING_OUTCOMES = ["accepted", "unparseable", "schema_rejected", "empty_objective"] as const;
export type QualifyingOutcome = (typeof QUALIFYING_OUTCOMES)[number];

export const OPERATIONAL_OUTCOMES = [
  "disabled", "no_context", "no_model", "auth_failed", "timeout", "provider_error", "threw", "stale",
] as const;
export type OperationalOutcome = (typeof OPERATIONAL_OUTCOMES)[number];

const ALL_OUTCOMES = new Set<string>([...QUALIFYING_OUTCOMES, ...OPERATIONAL_OUTCOMES]);

/**
 * 30 was pinned so a 4/7 or 1/1 sample (both observed in the field) cannot
 * decide whether an ambient model call survives. Below it the verdict is
 * always `inconclusive`, never `keep` or `delete`.
 */
export const MIN_QUALIFYING_SAMPLE = 30;
export const ACCEPT_RATE_THRESHOLD = 0.5;

/**
 * Versions `ExtractorDecisionRecord`'s own output shape — bumped only if that
 * shape changes in a way an old reader of the *decision output* couldn't
 * parse. This is deliberately a separate version space from
 * `HARNESS_EVENT_SCHEMA_VERSION` (the ledger *row* shape `classifyRow` reads
 * from): they happen to both be `1` today, but they version different
 * things and will diverge independently. `classifyRow`'s `future_schema`
 * check compares a row's `schemaVersion` against `HARNESS_EVENT_SCHEMA_VERSION`,
 * not this constant.
 */
export const DECISION_SCHEMA_VERSION = 1;

const SUMMARY_PREFIX = "semantic extraction: ";

export type ExtractorFateVerdict = "keep" | "delete" | "inconclusive";

export type RowRejectionReason =
  | "malformed"
  | "duplicate"
  | "stale_window"
  | "future_schema"
  | "provenance_missing"
  | "scope_mismatch"
  | "unscoped";

/**
 * The row shape `createLedgerExtractionReporter` writes today, plus optional
 * fields a future producer (Phase 4) may add. A row missing the optional
 * fields is not rejected on that basis alone — scoping to a repository/
 * revision/schema-version is opt-in per row; the caller-supplied
 * `ObservationWindow` is what actually scopes a read.
 */
export interface ExtractionLedgerRow {
  type?: unknown;
  taskId?: unknown;
  summary?: unknown;
  evidence?: unknown;
  outcome?: unknown;
  createdAt?: unknown;
  model?: unknown;
  repository?: unknown;
  revision?: unknown;
  schemaVersion?: unknown;
}

/**
 * Describes one decision read: which repository/revision it applies to, the
 * time range of rows it admits, and enough context to reproduce the same
 * verdict later from the same recorded rows. Supplied by the caller — this
 * module never touches the filesystem, network, or a clock to discover it.
 *
 * ### Window Semantics & Legitimacy:
 * 1. **Per-Repository Scoping:** An observation window is strictly scoped to
 *    one repository (`window.repository`). Legacy ledger rows that predate
 *    scoped emission (i.e. missing the `repository` field or empty string)
 *    are rejected with `RowRejectionReason = "unscoped"` rather than counted
 *    toward every repository simultaneously.
 * 2. **Revision & Schema Digest — declared, not yet enforced.** These are
 *    *intended* to pin the prompt/engine logic (`revision`: a git commit SHA,
 *    e.g. from `git rev-parse HEAD`) and the `TaskContract` JSON schema
 *    (`contractSchemaDigest`, from `src/spec/contract.ts`) an evaluation ran
 *    against. Today no emitted row carries either field, so the equality checks
 *    below (`:180`) never reject on them and neither value narrows the admitted
 *    set — they record the provenance of the *report*, not of the rows. Treat a
 *    window's claim here as a label until the reporter emits both per row; see
 *    `docs/adr/0006-completion-verification-gate.md`, amendment 2026-08-08.
 * 3. **Time Bounds (`start` / `end`):**
 *    - `start` and `end` must be ISO-8601 timestamps bracketing a cohesive
 *      measurement epoch (e.g. after a specific repair or prompt revision).
 *      An unbounded window is invalid because it conflates pre- and post-repair
 *      extractor configurations.
 */
export interface ObservationWindow {
  id: string;
  repository: string;
  revision: string;
  start: string;
  end: string;
  effectiveModel?: string;
  effectiveTimeoutMs?: number;
  contractSchemaDigest: string;
}

export interface ExtractorDecisionInput {
  window: ObservationWindow;
  rows: readonly unknown[];
  /** `gate_failure` count over the same window; reported, never decided on. */
  gateFailureCount?: number;
}

export interface ExtractorDecisionRecord {
  schemaVersion: number;
  verdict: ExtractorFateVerdict;
  window: ObservationWindow;
  qualifyingTotal: number;
  acceptedCount: number;
  /** `undefined` when `qualifyingTotal` is 0 — there is no rate, not a rate of 0. */
  acceptRate: number | undefined;
  outcomeCounts: Partial<Record<ExtractionOutcome, number>>;
  gateFailureCount: number | undefined;
  acceptedRowCount: number;
  rejectedRowCount: number;
  rejectionReasons: Partial<Record<RowRejectionReason, number>>;
  decidedAt: string;
}

function outcomeFromSummary(summary: string): ExtractionOutcome | undefined {
  if (!summary.startsWith(SUMMARY_PREFIX)) return undefined;
  const candidate = summary.slice(SUMMARY_PREFIX.length);
  return ALL_OUTCOMES.has(candidate) ? (candidate as ExtractionOutcome) : undefined;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * `reason` set means rejected; `outcome`/`dedupeKey` set means accepted. Kept
 * as one flat shape rather than a `{ ok: true } | { ok: false }` union because
 * this repo's `tsconfig.json` runs with `strict: false`, and without
 * `strictNullChecks` on, `tsc` does not narrow a discriminated union on a
 * boolean tag — every branch keeps seeing the full union.
 */
interface RowClassification {
  reason?: RowRejectionReason;
  outcome?: ExtractionOutcome;
  dedupeKey?: string;
}

function classifyRow(row: unknown, window: ObservationWindow): RowClassification {
  if (typeof row !== "object" || row === null) return { reason: "malformed" };
  const candidate = row as ExtractionLedgerRow;

  if (candidate.type !== "spec_extraction") return { reason: "malformed" };
  if (typeof candidate.summary !== "string") return { reason: "malformed" };
  const outcome = outcomeFromSummary(candidate.summary);
  if (!outcome) return { reason: "malformed" };

  const taskId = candidate.taskId;
  if (typeof taskId !== "string" || taskId.trim() === "") return { reason: "provenance_missing" };
  if (!isValidTimestamp(candidate.createdAt)) return { reason: "provenance_missing" };
  const createdAt = candidate.createdAt as string;

  if (typeof candidate.repository !== "string" || candidate.repository.trim() === "") {
    return { reason: "unscoped" };
  }
  if (candidate.repository !== window.repository) {
    return { reason: "scope_mismatch" };
  }
  if (candidate.revision !== undefined && candidate.revision !== window.revision) {
    return { reason: "scope_mismatch" };
  }

  if (typeof candidate.schemaVersion === "number" && candidate.schemaVersion > HARNESS_EVENT_SCHEMA_VERSION) {
    return { reason: "future_schema" };
  }

  if (createdAt < window.start || createdAt > window.end) {
    return { reason: "stale_window" };
  }

  return { outcome, dedupeKey: `${taskId}|${createdAt}|${outcome}` };
}

/**
 * Pure aggregation over already-collected rows: no filesystem, network, or
 * clock read beyond the optional `decidedAt` override, so the same input
 * always reproduces the same verdict.
 */
export function decideExtractorFate(
  input: ExtractorDecisionInput,
  options: { decidedAt?: string } = {},
): ExtractorDecisionRecord {
  const outcomeCounts: Partial<Record<ExtractionOutcome, number>> = {};
  const rejectionReasons: Partial<Record<RowRejectionReason, number>> = {};
  const seen = new Set<string>();

  let acceptedRowCount = 0;
  let rejectedRowCount = 0;

  for (const row of input.rows) {
    const classification = classifyRow(row, input.window);
    if (classification.reason) {
      rejectedRowCount += 1;
      rejectionReasons[classification.reason] = (rejectionReasons[classification.reason] ?? 0) + 1;
      continue;
    }
    const outcome = classification.outcome as ExtractionOutcome;
    const dedupeKey = classification.dedupeKey as string;
    if (seen.has(dedupeKey)) {
      rejectedRowCount += 1;
      rejectionReasons.duplicate = (rejectionReasons.duplicate ?? 0) + 1;
      continue;
    }
    seen.add(dedupeKey);
    acceptedRowCount += 1;
    outcomeCounts[outcome] = (outcomeCounts[outcome] ?? 0) + 1;
  }

  const qualifyingTotal = QUALIFYING_OUTCOMES.reduce((sum, outcome) => sum + (outcomeCounts[outcome] ?? 0), 0);
  const acceptedCount = outcomeCounts.accepted ?? 0;
  const acceptRate = qualifyingTotal > 0 ? acceptedCount / qualifyingTotal : undefined;

  const verdict: ExtractorFateVerdict =
    qualifyingTotal < MIN_QUALIFYING_SAMPLE
      ? "inconclusive"
      : (acceptRate ?? 0) >= ACCEPT_RATE_THRESHOLD
        ? "keep"
        : "delete";

  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    verdict,
    window: input.window,
    qualifyingTotal,
    acceptedCount,
    acceptRate,
    outcomeCounts,
    gateFailureCount: input.gateFailureCount,
    acceptedRowCount,
    rejectedRowCount,
    rejectionReasons,
    decidedAt: options.decidedAt ?? new Date().toISOString(),
  };
}

/**
 * Reads exactly the JSONL files named — never a directory walk or a `$HOME`
 * traversal — and stops at `maxLines` total parsed entries so a runaway
 * ledger cannot make a test (or a decision run) unbounded. A line that fails
 * to parse becomes a `malformed`-classified row rather than throwing, so one
 * corrupt line does not sink the whole read.
 */
export async function readExtractionLedgerRows(
  filePaths: readonly string[],
  options: { maxLines?: number } = {},
): Promise<{ rows: unknown[]; truncated: boolean }> {
  const maxLines = options.maxLines ?? 50_000;
  const rows: unknown[] = [];
  let truncated = false;

  for (const filePath of filePaths) {
    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (line.trim() === "") continue;
        if (rows.length >= maxLines) {
          truncated = true;
          break;
        }
        try {
          rows.push(JSON.parse(line));
        } catch {
          rows.push({ type: "malformed_line" });
        }
      }
    } finally {
      // rl.close() alone does not release the underlying file descriptor —
      // destroy the stream explicitly so an early break on truncation
      // doesn't leak it.
      rl.close();
      stream.destroy();
    }
    if (truncated) break;
  }

  return { rows, truncated };
}
