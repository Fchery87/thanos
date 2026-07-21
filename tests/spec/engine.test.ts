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
    expect(active?.taskContract.objective).toContain("billing flow");
  });

  it("derives structured task contract kinds for fix and secure requests", () => {
    const fixSpec = generateSpec("Fix the session timeout bug and verify it", "ambient");
    const secureSpec = generateSpec("Secure the auth flow and verify policy behavior", "ambient");

    expect(fixSpec.taskContract.criteria.some((criterion) => criterion.kind === "fix")).toBe(true);
    expect(secureSpec.taskContract.criteria.some((criterion) => criterion.kind === "secure")).toBe(true);
  });

  it("uses default-fail contract criteria for generated specs", () => {
    const spec = new SpecEngine();

    const active = spec.startTurn("Add pagination with tests and update docs", false);

    expect(active?.taskContract.criteria.some((criterion) => criterion.kind === "build")).toBe(true);
    expect(active?.acceptanceCriteria.map((c) => c.statement)).toEqual([
      "Requested code change is implemented in the relevant files",
      "Relevant tests or verification commands pass",
      "Requested documentation is updated",
    ]);
    expect(active?.acceptanceCriteria[0]?.evidenceRequired).toEqual(["diff"]);
    expect(active?.acceptanceCriteria[1]?.evidenceRequired).toEqual(["test"]);
    expect(active?.acceptanceCriteria[2]?.evidenceRequired).toEqual(["manual"]);
  });

  it("derives acceptance criteria from the task contract for rename requests", () => {
    const spec = generateSpec("Rename getCwd to getCurrentWorkingDirectory across the repo", "ambient");

    expect(spec.taskContract.criteria.some((criterion) => criterion.kind === "rename")).toBe(true);
    expect(spec.acceptanceCriteria.some((criterion) => criterion.statement.toLowerCase().includes("rename"))).toBe(true);
    expect(spec.acceptanceCriteria.some((criterion) => criterion.evidenceRequired.includes("diff"))).toBe(true);
    expect(spec.acceptanceCriteria.every((criterion) => criterion.statement.toLowerCase() !== "task outcome is explicitly demonstrated")).toBe(true);
  });

  it("derives acceptance criteria from the task contract for fix requests", () => {
    const spec = generateSpec("Fix the session timeout bug and verify it", "ambient");

    expect(spec.taskContract.criteria.some((criterion) => criterion.kind === "fix")).toBe(true);
    expect(spec.acceptanceCriteria.some((criterion) => criterion.statement.toLowerCase().includes("bug fix"))).toBe(true);
    expect(spec.acceptanceCriteria.some((criterion) => criterion.evidenceRequired.includes("diff"))).toBe(true);
    expect(spec.acceptanceCriteria.some((criterion) => criterion.evidenceRequired.includes("test") || criterion.evidenceRequired.includes("command"))).toBe(true);
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

  it("can preview a normalized explicit contract before approval", () => {
    const spec = new SpecEngine();
    const preview = spec.preview("Implement a new feature for the billing flow", true);

    expect(preview?.tier).toBe("explicit");
    expect(preview?.approvalStatus).toBe("pending");
    expect(preview?.taskContract.objective).toContain("billing flow");
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
    spec.recordEvidence({ kind: "diff", paths: ["src/billing/index.ts"], base: "abc", patchHash: "h1", passed: true });
    spec.recordEvidence({ kind: "test", runner: "vitest", normalizedExecutable: "vitest", args: ["run", "tests/billing"], exitCode: 0, passed: true });

    const results = spec.finishTurn([]);

    expect(results).toHaveLength(2);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.evidence).toEqual(["diff: [src/billing/index.ts]"]);
    expect(results[1]?.passed).toBe(true);
    expect(results[1]?.evidence[0]).toContain("vitest");
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
