import { describe, expect, it } from "vitest";
import { buildDefaultFailContract } from "../../src/spec/contract";

describe("buildDefaultFailContract", () => {
  it("turns implementation prompts into evidence-backed criteria", () => {
    const contract = buildDefaultFailContract("Add pagination with tests and update docs");

    expect(contract.acceptanceCriteria.map((c) => c.statement)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/code change/i),
        expect.stringMatching(/tests|verification/i),
        expect.stringMatching(/documentation/i),
      ]),
    );
    expect(contract.acceptanceCriteria.every((c) => c.evidenceRequired.length > 0)).toBe(true);
    expect(contract.acceptanceCriteria.some((c) => c.evidenceRequired.includes("test"))).toBe(true);
    expect(contract.acceptanceCriteria.some((c) => c.evidenceRequired.includes("diff"))).toBe(true);
  });

  it("keeps criteria default-fail by requiring concrete evidence", () => {
    const contract = buildDefaultFailContract("Refactor auth module and verify behavior");

    expect(contract.acceptanceCriteria).not.toHaveLength(0);
    expect(contract.acceptanceCriteria.every((c) => c.evidenceRequired.length > 0)).toBe(true);
  });
});
