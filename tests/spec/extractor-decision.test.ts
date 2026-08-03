import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCEPT_RATE_THRESHOLD,
  decideExtractorFate,
  MIN_QUALIFYING_SAMPLE,
  readExtractionLedgerRows,
  type ObservationWindow,
} from "../../src/spec/extractor-decision";
import type { ExtractionOutcome } from "../../src/spec/extraction-log";

const window: ObservationWindow = {
  id: "window-1",
  repository: "/repo/thanos",
  revision: "abc123",
  start: "2026-07-01T00:00:00.000Z",
  end: "2026-07-31T23:59:59.999Z",
  contractSchemaDigest: "digest-1",
};

let taskCounter = 0;
function nextTaskId(): string {
  taskCounter += 1;
  return `task-${taskCounter}`;
}

function makeRow(
  outcome: ExtractionOutcome,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "spec_extraction",
    taskId: nextTaskId(),
    summary: `semantic extraction: ${outcome}`,
    outcome: outcome === "accepted" ? "ok" : "fell_back",
    createdAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

function makeRows(outcome: ExtractionOutcome, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, () => makeRow(outcome));
}

describe("decideExtractorFate", () => {
  it("is inconclusive with zero rows", () => {
    const decision = decideExtractorFate({ window, rows: [] });
    expect(decision.verdict).toBe("inconclusive");
    expect(decision.qualifyingTotal).toBe(0);
    expect(decision.acceptRate).toBeUndefined();
  });

  it(`is inconclusive at ${MIN_QUALIFYING_SAMPLE - 1} qualifying outcomes, even at 100% accepted`, () => {
    const rows = makeRows("accepted", MIN_QUALIFYING_SAMPLE - 1);
    const decision = decideExtractorFate({ window, rows });
    expect(decision.qualifyingTotal).toBe(MIN_QUALIFYING_SAMPLE - 1);
    expect(decision.verdict).toBe("inconclusive");
  });

  it(`keeps at exactly ${MIN_QUALIFYING_SAMPLE} qualifying outcomes and exactly ${ACCEPT_RATE_THRESHOLD * 100}% accepted`, () => {
    const half = MIN_QUALIFYING_SAMPLE / 2;
    const rows = [...makeRows("accepted", half), ...makeRows("schema_rejected", half)];
    const decision = decideExtractorFate({ window, rows });
    expect(decision.qualifyingTotal).toBe(MIN_QUALIFYING_SAMPLE);
    expect(decision.acceptRate).toBe(0.5);
    expect(decision.verdict).toBe("keep");
  });

  it("deletes when qualifying but below the accept-rate threshold", () => {
    const rows = [
      ...makeRows("accepted", 14),
      ...makeRows("unparseable", 10),
      ...makeRows("empty_objective", 6),
    ];
    const decision = decideExtractorFate({ window, rows });
    expect(decision.qualifyingTotal).toBe(30);
    expect(decision.acceptRate).toBeCloseTo(14 / 30);
    expect(decision.verdict).toBe("delete");
  });

  it("excludes operational outcomes from the qualifying denominator no matter the volume", () => {
    const qualifying = [...makeRows("accepted", 20), ...makeRows("schema_rejected", 10)];
    const operational = [
      ...makeRows("timeout", 500),
      ...makeRows("disabled", 200),
      ...makeRows("no_context", 50),
      ...makeRows("no_model", 50),
      ...makeRows("auth_failed", 50),
      ...makeRows("provider_error", 50),
      ...makeRows("threw", 50),
      ...makeRows("stale", 50),
    ];
    const decision = decideExtractorFate({ window, rows: [...qualifying, ...operational] });
    expect(decision.qualifyingTotal).toBe(30);
    expect(decision.acceptRate).toBeCloseTo(20 / 30);
    expect(decision.verdict).toBe("keep");
    expect(decision.acceptedRowCount).toBe(30 + 500 + 200 + 50 + 50 + 50 + 50 + 50 + 50);
  });

  it("rejects an exact duplicate row rather than double-counting it", () => {
    const row = makeRow("accepted", { taskId: "dup-1", createdAt: "2026-07-10T00:00:00.000Z" });
    const decision = decideExtractorFate({ window, rows: [row, { ...row }] });
    expect(decision.acceptedRowCount).toBe(1);
    expect(decision.rejectedRowCount).toBe(1);
    expect(decision.rejectionReasons.duplicate).toBe(1);
  });

  it("rejects malformed rows: non-objects, wrong type, unparseable summary", () => {
    const rows = [
      "not an object",
      42,
      null,
      { type: "gate_failure", taskId: "x", summary: "verification gate", createdAt: "2026-07-10T00:00:00.000Z" },
      { type: "spec_extraction", taskId: "x", summary: "semantic extraction: not_a_real_outcome", createdAt: "2026-07-10T00:00:00.000Z" },
      { type: "spec_extraction", taskId: "x", summary: 12345, createdAt: "2026-07-10T00:00:00.000Z" },
    ];
    const decision = decideExtractorFate({ window, rows });
    expect(decision.acceptedRowCount).toBe(0);
    expect(decision.rejectedRowCount).toBe(rows.length);
    expect(decision.rejectionReasons.malformed).toBe(rows.length);
  });

  it("rejects rows tagged with the wrong repository or revision", () => {
    const wrongRepo = makeRow("accepted", { repository: "/repo/other" });
    const wrongRevision = makeRow("accepted", { revision: "zzz999" });
    const decision = decideExtractorFate({ window, rows: [wrongRepo, wrongRevision] });
    expect(decision.acceptedRowCount).toBe(0);
    expect(decision.rejectionReasons.scope_mismatch).toBe(2);
  });

  it("rejects rows created outside the observation window", () => {
    const before = makeRow("accepted", { createdAt: "2026-06-30T23:59:59.999Z" });
    const after = makeRow("accepted", { createdAt: "2026-08-01T00:00:00.000Z" });
    const decision = decideExtractorFate({ window, rows: [before, after] });
    expect(decision.acceptedRowCount).toBe(0);
    expect(decision.rejectionReasons.stale_window).toBe(2);
  });

  it("rejects rows missing taskId or createdAt as provenance-missing", () => {
    const noTaskId = makeRow("accepted", { taskId: undefined });
    const noCreatedAt = makeRow("accepted", { createdAt: undefined });
    const decision = decideExtractorFate({ window, rows: [noTaskId, noCreatedAt] });
    expect(decision.acceptedRowCount).toBe(0);
    expect(decision.rejectionReasons.provenance_missing).toBe(2);
  });

  it("rejects a row declaring a schema version newer than this reader understands", () => {
    const row = makeRow("accepted", { schemaVersion: 999 });
    const decision = decideExtractorFate({ window, rows: [row] });
    expect(decision.rejectionReasons.future_schema).toBe(1);
  });

  it("passes gate-failure count through untouched, never as a decision input", () => {
    const rows = makeRows("accepted", MIN_QUALIFYING_SAMPLE);
    const decision = decideExtractorFate({ window, rows, gateFailureCount: 739 });
    expect(decision.gateFailureCount).toBe(739);
    expect(decision.verdict).toBe("keep");
  });

  it("is reproducible: identical input always yields an identical verdict", () => {
    const rows = [...makeRows("accepted", 12), ...makeRows("unparseable", 18)];
    const first = decideExtractorFate({ window, rows }, { decidedAt: "2026-08-02T00:00:00.000Z" });
    const second = decideExtractorFate({ window, rows }, { decidedAt: "2026-08-02T00:00:00.000Z" });
    expect(second).toEqual(first);
  });
});

describe("readExtractionLedgerRows", () => {
  it("reads only the named files, never a directory walk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "extractor-decision-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, `${JSON.stringify(makeRow("accepted"))}\n${JSON.stringify(makeRow("timeout"))}\n`);

    const { rows, truncated } = await readExtractionLedgerRows([path]);
    expect(rows).toHaveLength(2);
    expect(truncated).toBe(false);
  });

  it("turns an unparseable line into a malformed row instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "extractor-decision-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, `${JSON.stringify(makeRow("accepted"))}\nnot json\n${JSON.stringify(makeRow("accepted"))}\n`);

    const { rows } = await readExtractionLedgerRows([path]);
    expect(rows).toHaveLength(3);
    const decision = decideExtractorFate({ window, rows });
    expect(decision.rejectionReasons.malformed).toBe(1);
  });

  it("skips blank lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "extractor-decision-"));
    const path = join(dir, "events.jsonl");
    await writeFile(path, `${JSON.stringify(makeRow("accepted"))}\n\n\n${JSON.stringify(makeRow("accepted"))}\n`);

    const { rows } = await readExtractionLedgerRows([path]);
    expect(rows).toHaveLength(2);
  });

  it("stops at maxLines and reports truncation rather than reading unbounded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "extractor-decision-"));
    const path = join(dir, "events.jsonl");
    const lines = Array.from({ length: 10 }, () => JSON.stringify(makeRow("accepted"))).join("\n");
    await writeFile(path, `${lines}\n`);

    const { rows, truncated } = await readExtractionLedgerRows([path], { maxLines: 3 });
    expect(rows).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it("reads multiple named files in order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "extractor-decision-"));
    const pathA = join(dir, "a.jsonl");
    const pathB = join(dir, "b.jsonl");
    await writeFile(pathA, `${JSON.stringify(makeRow("accepted"))}\n`);
    await writeFile(pathB, `${JSON.stringify(makeRow("timeout"))}\n`);

    const { rows } = await readExtractionLedgerRows([pathA, pathB]);
    expect(rows).toHaveLength(2);
  });
});

describe("end to end against the reference fixtures", () => {
  const fixtureWindow: ObservationWindow = {
    id: "fixture-window",
    repository: "/repo/thanos-example",
    revision: "fixture-rev-1",
    start: "2026-07-01T00:00:00.000Z",
    end: "2026-07-31T23:59:59.999Z",
    contractSchemaDigest: "fixture-digest",
  };

  it("keeps on the qualified fixture: 30 qualifying, 20 accepted", async () => {
    const { rows } = await readExtractionLedgerRows(["tests/fixtures/observability/extractor-decision/qualified.jsonl"]);
    const decision = decideExtractorFate({ window: fixtureWindow, rows });
    expect(decision.qualifyingTotal).toBe(30);
    expect(decision.acceptedCount).toBe(20);
    expect(decision.verdict).toBe("keep");
  });

  it("stays inconclusive on the operational-only fixture no matter the row count", async () => {
    const { rows } = await readExtractionLedgerRows(["tests/fixtures/observability/extractor-decision/operational.jsonl"]);
    const decision = decideExtractorFate({ window: fixtureWindow, rows });
    expect(decision.qualifyingTotal).toBe(0);
    expect(decision.acceptedRowCount).toBe(40);
    expect(decision.verdict).toBe("inconclusive");
  });
});
