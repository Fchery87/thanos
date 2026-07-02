import { describe, expect, it } from "vitest";
import {
  serializeHarnessChange,
  validateHarnessChange,
  type HarnessChangeManifest,
} from "../../src/observability/change-manifest";

const validManifest = (overrides: Partial<HarnessChangeManifest> = {}): HarnessChangeManifest => ({
  id: "m7-ledger",
  createdAt: "2026-06-30T00:00:00.000Z",
  failureEvidence: ["Gate loop repeated without durable trace"],
  rootCause: "Harness failures were not recorded as training data",
  targetedFix: "Serialize high-signal harness events to JSONL",
  predictedImpact: "Future harness changes can be tied to observed failures",
  regressionRisk: "Could log sensitive prompts if event fields are too broad",
  followUpCheck: "Review event ledger after three failed-gate sessions",
  ...overrides,
});

describe("validateHarnessChange", () => {
  it("accepts a complete evidence-backed manifest", () => {
    expect(validateHarnessChange(validManifest())).toEqual(validManifest());
  });

  it("requires failure evidence", () => {
    expect(() => validateHarnessChange(validManifest({ failureEvidence: [] }))).toThrow(/failure evidence/i);
  });

  it("requires root cause, targeted fix, predicted impact, regression risk, and follow-up", () => {
    for (const field of ["rootCause", "targetedFix", "predictedImpact", "regressionRisk", "followUpCheck"] as const) {
      expect(() => validateHarnessChange(validManifest({ [field]: "" }))).toThrow(field);
    }
  });
});

describe("serializeHarnessChange", () => {
  it("serializes valid manifest entries as JSONL", () => {
    const line = serializeHarnessChange(validManifest());

    expect(JSON.parse(line)).toMatchObject({ id: "m7-ledger" });
    expect(line.endsWith("\n")).toBe(true);
  });
});
