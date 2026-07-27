import { describe, expect, it, vi } from "vitest";
import { SpecEngine } from "../../src/spec/engine";
import { ContractExtractor } from "../../src/spec/extractor";
import type { ExtractionReport } from "../../src/spec/extraction-log";

/**
 * Semantic extraction shipped, ran 48 times, produced nothing, and reported
 * nothing. Every path returned `undefined` and the deterministic contract stood
 * in, so the harness looked healthy while the feature was dead.
 *
 * Fail-safe is not the thing under test here — that behaviour is unchanged and
 * is asserted alongside each case. What is under test is that the reason is
 * recorded, because the fraction of attempts reaching `accepted` is what decides
 * whether src/spec/ survives Phase 3.
 */
function collector() {
  const reports: ExtractionReport[] = [];
  return { reports, report: (r: ExtractionReport) => { reports.push(r); } };
}

const settings = { extraction: true, extractorRole: "evaluator", timeoutMs: 50 };

describe("ContractExtractor reports why it gave up", () => {
  it("reports `disabled` when extraction is switched off in settings", async () => {
    const { reports, report } = collector();
    const extractor = new ContractExtractor({ ...settings, extraction: false }, report);

    await expect(extractor.extract("do a thing", "ambient")).resolves.toBeUndefined();
    expect(reports).toEqual([{ outcome: "disabled", detail: "extraction=false" }]);
  });

  it("reports `disabled` for an instant-tier prompt, which is never extracted", async () => {
    const { reports, report } = collector();
    const extractor = new ContractExtractor(settings, report);

    await extractor.extract("what is this", "instant");
    expect(reports).toEqual([{ outcome: "disabled", detail: "tier=instant" }]);
  });

  it("reports `no_context` before before_agent_start hands over a context", async () => {
    const { reports, report } = collector();
    const extractor = new ContractExtractor(settings, report);

    await expect(extractor.extract("do a thing", "ambient")).resolves.toBeUndefined();
    expect(reports).toEqual([{ outcome: "no_context" }]);
  });

  it("reports `no_model` when no model can be resolved", async () => {
    const { reports, report } = collector();
    const extractor = new ContractExtractor(settings, report);
    extractor.setContext({ model: undefined, modelRegistry: {} } as never);

    await expect(extractor.extract("do a thing", "ambient")).resolves.toBeUndefined();
    expect(reports).toEqual([{ outcome: "no_model", detail: "role=evaluator" }]);
  });

  // The most likely silent failure in production: resolveEvaluatorAuth throws
  // for any models.json-configured provider without a resolvable key, and the
  // old code swallowed it into the same undefined as everything else.
  it("reports `auth_failed` distinctly rather than as a generic throw", async () => {
    const { reports, report } = collector();
    const extractor = new ContractExtractor(settings, report);
    extractor.setContext({
      model: { provider: "acme", id: "m1" },
      modelRegistry: {
        getAll: () => [],
        hasConfiguredAuth: () => false,
        getApiKeyAndHeaders: async () => ({ ok: false, error: "No API key" }),
      },
    } as never);

    await expect(extractor.extract("do a thing", "ambient")).resolves.toBeUndefined();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.outcome).toBe("auth_failed");
    expect(reports[0]?.detail).toContain("No API key");
  });
});

describe("SpecEngine reports what happened to a candidate", () => {
  it("reports `schema_rejected` and names the failing rule", async () => {
    const { reports, report } = collector();
    const engine = new SpecEngine(async () => ({
      objective: "Add pagination",
      criteria: [{ id: "c1", kind: "build", statement: "s", evidence: ["diff"], source: "semantic_extraction", targets: ["/etc/passwd"] }],
    }), report);

    engine.startTurn("Add pagination with tests", false);
    await engine.settleContract();

    expect(reports).toHaveLength(1);
    expect(reports[0]?.outcome).toBe("schema_rejected");
    expect(reports[0]?.detail).toContain("criteria[0]");
    // Fail-safe: the deterministic contract is still standing.
    expect(engine.activeSpec?.taskContract.criteria[0]?.source).toBe("deterministic_fallback");
  });

  it("reports `accepted` with a criteria count when extraction lands", async () => {
    const { reports, report } = collector();
    const engine = new SpecEngine(async () => ({
      objective: "Add pagination",
      criteria: [{ id: "c1", kind: "build", statement: "Pagination lands", evidence: ["diff"], source: "semantic_extraction" }],
    }), report);

    engine.startTurn("Add pagination with tests", false);
    await engine.settleContract();

    expect(reports).toEqual([{ outcome: "accepted", criteriaCount: 1 }]);
    expect(engine.activeSpec?.taskContract.criteria[0]?.source).toBe("semantic_extraction");
  });

  it("reports `empty_objective` for the contract shape settleContract discards", async () => {
    const { reports, report } = collector();
    const engine = new SpecEngine(async () => ({
      objective: "",
      criteria: [{ id: "c1", kind: "build", statement: "s", evidence: ["diff"], source: "semantic_extraction" }],
    }), report);

    engine.startTurn("Add pagination with tests", false);
    await engine.settleContract();

    expect(reports).toEqual([{ outcome: "empty_objective" }]);
  });

  it("reports `stale` when a newer turn replaced the spec mid-flight", async () => {
    const { reports, report } = collector();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const engine = new SpecEngine(async () => {
      await gate;
      return { objective: "Add pagination", criteria: [{ id: "c1", kind: "build", statement: "s", evidence: ["diff"], source: "semantic_extraction" }] };
    }, report);

    engine.startTurn("Add pagination with tests", false);
    const settling = engine.settleContract();
    engine.startTurn("A completely different request now", false);
    release?.();
    await settling;

    expect(reports).toEqual([{ outcome: "stale" }]);
  });

  it("stays silent about engine-side outcomes when the extractor already reported", async () => {
    const { reports, report } = collector();
    const engine = new SpecEngine(async () => undefined, report);

    engine.startTurn("Add pagination with tests", false);
    await engine.settleContract();

    expect(reports).toEqual([]);
  });

  it("reports nothing at all when no reporter is wired", async () => {
    const engine = new SpecEngine(async () => undefined);
    engine.startTurn("Add pagination with tests", false);
    await expect(engine.settleContract()).resolves.toBeUndefined();
  });
});

describe("the ledger reporter never breaks a turn", () => {
  it("swallows a failing append instead of rejecting", async () => {
    const { createLedgerExtractionReporter } = await import("../../src/spec/extraction-log");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A path that cannot be created, so appendHarnessEvent's mkdir rejects.
    const reporter = createLedgerExtractionReporter("task-1", "/proc/nonexistent-harness-target");

    expect(() => reporter({ outcome: "timeout", detail: "50ms" })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    spy.mockRestore();
  });
});
