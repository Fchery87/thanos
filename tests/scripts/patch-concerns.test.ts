import { describe, expect, it } from "vitest";
import {
  PATCH_MARKERS,
  HUNK_CEILING,
  countConcerns,
  formatConcernCeilingWarning,
} from "../../scripts/patch-pi-subagents.mjs";

// ADR 0024's tripwire #2 counts distinct patched *concerns*, not patched
// *files* — three of the five real markers (delegation.ts,
// delegation-request.ts, delegation-adapters.ts) are all one concern, the
// evidence envelope, spread across three files. Counting files put the real
// artifact at 5 against a ceiling of 4 and fired on every run; counting
// concerns puts it at 3, with one concern of headroom. See
// docs/adr/0024-pi-subagents-stays-a-dependency-until-these-tripwires-fire.md
// ("Recalibration (2026-08-07)").

describe("ADR 0024 concern ceiling", () => {
  it("derives exactly 3 distinct concerns from today's real PATCH_MARKERS", () => {
    expect(countConcerns(PATCH_MARKERS)).toBe(3);
  });

  it("keeps every marker entry declaring a concern name (4th element)", () => {
    for (const marker of PATCH_MARKERS) {
      expect(typeof marker[3]).toBe("string");
      expect(marker[3]).not.toBe("");
    }
  });

  it("leaves the ceiling at 4 — a guardrail against quietly raising it", () => {
    expect(HUNK_CEILING).toBe(4);
  });

  it("does not fire against the real 3-concern marker list", () => {
    expect(formatConcernCeilingWarning(PATCH_MARKERS, HUNK_CEILING)).toBeUndefined();
  });

  it("does not fire at exactly 4 distinct concerns (synthetic, at the ceiling)", () => {
    const fourConcerns = [
      ["a", "one.ts", "marker-1", "concern-a"],
      ["a", "two.ts", "marker-2", "concern-b"],
      ["a", "three.ts", "marker-3", "concern-c"],
      ["a", "four.ts", "marker-4", "concern-d"],
    ];
    expect(countConcerns(fourConcerns)).toBe(4);
    expect(formatConcernCeilingWarning(fourConcerns, HUNK_CEILING)).toBeUndefined();
  });

  it("DOES fire at 5 distinct concerns (synthetic) — proves the alarm still has teeth", () => {
    const fiveConcerns = [
      ["a", "one.ts", "marker-1", "concern-a"],
      ["a", "two.ts", "marker-2", "concern-b"],
      ["a", "three.ts", "marker-3", "concern-c"],
      ["a", "four.ts", "marker-4", "concern-d"],
      ["a", "five.ts", "marker-5", "concern-e"],
    ];
    expect(countConcerns(fiveConcerns)).toBe(5);
    const warning = formatConcernCeilingWarning(fiveConcerns, HUNK_CEILING);
    expect(warning).toBeDefined();
    expect(warning).toContain("5 concerns");
    expect(warning).toContain("ceiling 4");
    expect(warning).toContain("ADR 0024");
  });

  it("still fires at 5 markers that only span 3 concerns worth of file-count, i.e. counts concerns not files", () => {
    // Same file count (5) as today's real list, but each marker is given its
    // own concern name — proving the function counts distinct concern names,
    // not array length, and would have fired under the old file-counting bug.
    const fiveFilesFiveConcerns = PATCH_MARKERS.map((marker, index) => [
      marker[0],
      marker[1],
      marker[2],
      `synthetic-concern-${index}`,
    ]);
    expect(fiveFilesFiveConcerns.length).toBe(5);
    expect(countConcerns(fiveFilesFiveConcerns)).toBe(5);
    expect(formatConcernCeilingWarning(fiveFilesFiveConcerns, HUNK_CEILING)).toBeDefined();
  });
});
