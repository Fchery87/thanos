import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { FindingParamsSchema, addFinding, verdictForFindings } from "../../src/review/findings";

describe("FindingParamsSchema", () => {
  it("accepts P0-P3 findings with evidence", () => {
    expect(Value.Check(FindingParamsSchema, {
      priority: "P1",
      summary: "Policy bypass",
      rationale: "The tool skips governance checks.",
      file: "src/index.ts",
      line: 123,
      suggestedFix: "Route through governed tool call evaluation.",
    })).toBe(true);
  });

  it("rejects invalid priority", () => {
    expect(Value.Check(FindingParamsSchema, {
      priority: "P4",
      summary: "Nit",
      rationale: "Invalid.",
    })).toBe(false);
  });
});

describe("review verdict", () => {
  it("requests changes for P0-P1 findings", () => {
    const findings = addFinding([], { priority: "P1", summary: "Bug", rationale: "Breaks policy." });
    expect(verdictForFindings(findings)).toBe("request-changes");
  });

  it("comments for P2-P3 findings", () => {
    const findings = addFinding([], { priority: "P3", summary: "Nit", rationale: "Minor." });
    expect(verdictForFindings(findings)).toBe("comment");
  });

  it("approves when no findings exist", () => {
    expect(verdictForFindings([])).toBe("approve");
  });
});
