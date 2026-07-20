import { describe, expect, it } from "vitest";
import { SpecEngine } from "../../src/spec/engine";
import { generateSpec } from "../../src/spec/generator";
import type { EvidenceRecord } from "../../src/spec/claims";

const MANUAL_EV: EvidenceRecord = { kind: "manual", actor: "user", claim: "done manually", passed: true };

describe("SpecEngine lifecycle", () => {
  it("does not create a spec for instant prompts", () => {
    const spec = new SpecEngine();

    expect(spec.startTurn("What is this?", false)).toBeUndefined();
    expect(spec.activeSpec).toBeUndefined();
    expect(spec.verify()).toEqual([]);
  });

  it("creates an ambient spec without approval", () => {
    const spec = new SpecEngine();

    const active = spec.startTurn("Implement a new feature for the billing flow", false);

    expect(active?.tier).toBe("ambient");
    expect(active?.approvalStatus).toBe("not_required");
    expect(spec.activeSpec?.id).toBe(active?.id);
  });

  it("uses default-fail contract criteria for generated specs", () => {
    const spec = new SpecEngine();

    const active = spec.startTurn("Add pagination with tests and update docs", false);

    expect(active?.acceptanceCriteria.map((c) => c.statement)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/code change/i),
        expect.stringMatching(/tests|verification/i),
        expect.stringMatching(/documentation/i),
      ]),
    );
  });

  it("tracks gate attempts and resets them on a new turn", () => {
    const spec = new SpecEngine();

    spec.startTurn("Implement a new feature for the billing flow", false);
    expect(spec.gateAttempts).toBe(0);
    spec.recordGateAttempt();
    spec.recordGateAttempt();
    expect(spec.gateAttempts).toBe(2);

    spec.startTurn("Implement a new feature for the billing flow", false);
    expect(spec.gateAttempts).toBe(0);
  });

  it("creates an explicit spec with pending approval", () => {
    const spec = new SpecEngine();

    const active = spec.startTurn("Implement a new feature for the billing flow", true);

    expect(active?.tier).toBe("explicit");
    expect(active?.approvalStatus).toBe("pending");
  });

  it("clears prior evidence when a new prompt starts", () => {
    const spec = new SpecEngine();

    spec.startTurn("Complete the billing task with clear updates", false);
    spec.recordEvidence(MANUAL_EV);
    expect(spec.verify()[0]?.evidence).toHaveLength(1);

    spec.startTurn("Complete the reporting task with clear updates", false);
    expect(spec.verify().every((result) => result.evidence.length === 0)).toBe(true);
  });

  it("does not populate keywords on generated acceptance criteria", () => {
    const spec = generateSpec("Add a new feature", "ambient");

    for (const criterion of spec.acceptanceCriteria) {
      expect(criterion).not.toHaveProperty("keywords");
    }
  });

  it("does NOT create evidence from assistant prose", () => {
    const spec = new SpecEngine();

    expect(
      spec.finishTurn([
        { role: "assistant", content: [{ type: "text", text: "done" }] },
      ]),
    ).toEqual([]);

    spec.startTurn("Complete the billing task with clear updates", false);
    const results = spec.finishTurn([
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ]);

    // Assistant prose does NOT create passing evidence
    expect(results.every((r) => !r.passed || r.evidence.length === 0)).toBe(true);
  });

  it("returns evidence results from recorded tool evidence (not assistant prose)", () => {
    const spec = new SpecEngine();

    spec.startTurn("Implement the billing module with unit tests", false);
    spec.recordEvidence({ kind: "diff", paths: ["src/index.ts"], base: "abc", patchHash: "h1", passed: true });
    spec.recordEvidence({ kind: "test", runner: "vitest", args: [], exitCode: 0, passed: true });

    const results = spec.finishTurn([]);

    // diff criterion has diff evidence
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.evidence).toHaveLength(1);
    // test criterion has test evidence
    expect(results[1]?.passed).toBe(true);
    expect(results[1]?.evidence).toHaveLength(1);
  });

  it("does not record assistant text from an aborted turn as evidence", () => {
    const spec = new SpecEngine();
    spec.startTurn("Complete the billing task with clear updates", false);

    const results = spec.finishTurn(
      [{ role: "assistant", content: [{ type: "text", text: "done" }] }],
      { aborted: true },
    );

    // With no tool evidence collected, should fail on all criteria
    expect(results.every((result) => !result.passed)).toBe(true);
  });
});
