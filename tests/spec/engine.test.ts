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
    // A docs update is a file edit → diff (the runtime can emit it); it was
    // previously "manual", which the runtime agent cannot produce.
    expect(active?.acceptanceCriteria[2]?.evidenceRequired).toEqual(["diff"]);
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
    // Verification is a "test OR command" anyOf group, not a pre-guessed required kind.
    expect(spec.acceptanceCriteria.some((criterion) =>
      (criterion.evidenceAnyOf ?? []).some((group) => group.includes("test") && group.includes("command")))).toBe(true);
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

  it("is a no-op to settle when no extractor is wired", async () => {
    const spec = new SpecEngine();
    const active = spec.startTurn("Add pagination with tests", false);
    const before = JSON.stringify(active?.acceptanceCriteria);

    await spec.settleContract();

    expect(JSON.stringify(spec.activeSpec?.acceptanceCriteria)).toBe(before);
    expect(spec.activeSpec?.taskContract.criteria[0]?.source).toBe("deterministic_fallback");
  });

  it("installs the deterministic contract synchronously while extraction is in flight", () => {
    let release: (value: unknown) => void = () => {};
    const spec = new SpecEngine(() => new Promise((resolve) => { release = resolve; }));

    // No await: the spec must exist the instant the turn starts.
    const active = spec.startTurn("Add pagination with tests", false);

    expect(active?.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(active?.taskContract.criteria[0]?.source).toBe("deterministic_fallback");
    release(undefined);
  });

  it("upgrades the spec in place when extraction validates", async () => {
    const semantic = {
      objective: "Add pagination to the reporting module",
      criteria: [{
        id: "semantic-primary",
        kind: "build",
        statement: "Pagination lands in the reporting module",
        targets: ["src/reporting"],
        evidence: ["diff"],
        expectedExecutables: [],
        expectedArgs: [],
        mustNot: [],
        source: "semantic_extraction",
      }],
    };
    const spec = new SpecEngine(async () => semantic);
    const active = spec.startTurn("Add pagination with tests", false);
    const idBefore = active?.id;

    await spec.settleContract();

    expect(spec.activeSpec?.id).toBe(idBefore); // same object, mutated in place
    expect(spec.activeSpec?.taskContract.criteria[0]?.source).toBe("semantic_extraction");
    expect(spec.activeSpec?.acceptanceCriteria.map((c) => c.id)).toEqual(["semantic-primary"]);
  });

  it("keeps the deterministic contract when extraction rejects, throws, or is malformed", async () => {
    const cases: Array<() => Promise<unknown>> = [
      async () => { throw new Error("model unavailable"); },
      async () => undefined,
      async () => ({ objective: "", criteria: [] }),
      async () => ({ objective: "x", criteria: [{ id: "c", kind: "not-a-kind", statement: "s", targets: [], evidence: ["diff"], expectedExecutables: [], expectedArgs: [], mustNot: [], source: "semantic_extraction" }] }),
      async () => ({ objective: "x", criteria: [{ id: "c", kind: "build", statement: "s", targets: ["/etc"], evidence: ["diff"], expectedExecutables: [], expectedArgs: [], mustNot: [], source: "semantic_extraction" }] }),
    ];

    for (const extractor of cases) {
      const spec = new SpecEngine(extractor);
      spec.startTurn("Add pagination with tests", false);
      await spec.settleContract();

      expect(spec.activeSpec?.taskContract.criteria[0]?.source).toBe("deterministic_fallback");
      expect(spec.activeSpec?.acceptanceCriteria.length).toBeGreaterThan(0);
    }
  });

  it("discards an extraction that lands after the turn moved on", async () => {
    // Each startTurn kicks off its own extraction, so resolvers are collected
    // positionally — resolving by closure would settle the wrong promise.
    const resolvers: Array<(value: unknown) => void> = [];
    const spec = new SpecEngine(() => new Promise((resolve) => { resolvers.push(resolve); }));
    spec.startTurn("Add pagination with tests", false);

    const settling = spec.settleContract();
    spec.startTurn("Add a different feature with tests", false); // new turn, new spec

    resolvers[0]?.({
      objective: "stale",
      criteria: [{ id: "stale", kind: "build", statement: "stale", targets: [], evidence: ["diff"], expectedExecutables: [], expectedArgs: [], mustNot: [], source: "semantic_extraction" }],
    });
    await settling;

    expect(spec.activeSpec?.acceptanceCriteria.some((c) => c.id === "stale")).toBe(false);
    resolvers[1]?.(undefined);
  });

  it("settles at most once", async () => {
    let calls = 0;
    const spec = new SpecEngine(async () => { calls += 1; return undefined; });
    spec.startTurn("Add pagination with tests", false);

    await spec.settleContract();
    await spec.settleContract();

    expect(calls).toBe(1);
  });

  it("replaces tool-input diff evidence with git ground truth", () => {
    const spec = new SpecEngine();
    spec.startTurn("Add a pagination helper to the billing module", false);

    // What the edit tool was asked to do.
    spec.recordEvidence({ kind: "diff", paths: ["src/billing/claimed.ts"], base: "", patchHash: "", passed: true });
    // What the working tree actually shows.
    spec.replaceDiffEvidence({ kind: "diff", paths: ["src/billing/actual.ts"], base: "abc123", patchHash: "h1", passed: true });

    const evidence = spec.verify().flatMap((result) => result.evidence);
    expect(evidence.some((line) => line.includes("src/billing/actual.ts"))).toBe(true);
    expect(evidence.some((line) => line.includes("src/billing/claimed.ts"))).toBe(false);
  });

  it("drops claimed diffs entirely when the working tree shows no change", () => {
    const spec = new SpecEngine();
    spec.startTurn("Add a pagination helper to the billing module", false);
    spec.recordEvidence({ kind: "diff", paths: ["src/billing/claimed.ts"], base: "", patchHash: "", passed: true });

    // An edit that was reverted before the turn ended yields no ground truth.
    spec.replaceDiffEvidence(undefined);

    expect(spec.verify().every((result) => result.evidence.length === 0)).toBe(true);
  });

  it("leaves non-diff evidence untouched when replacing diffs", () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement the billing module with unit tests", false);
    // "billing" in the prompt makes inferExpectedArgs require that token, so the
    // run has to actually target the billing suite.
    spec.recordEvidence({ kind: "test", runner: "vitest", normalizedExecutable: "vitest", args: ["run", "tests/billing"], exitCode: 0, passed: true });
    spec.recordEvidence({ kind: "diff", paths: ["src/billing/claimed.ts"], base: "", patchHash: "", passed: true });

    spec.replaceDiffEvidence(undefined);

    const testResult = spec.verify().find((result) => result.criterion.id === "build-tests");
    expect(testResult?.passed).toBe(true);
  });

  it("clears the turn baseline on a new turn", () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement a new feature for the billing flow", false);
    spec.turnBaseline = Promise.resolve(new Map([["src/x.ts", "hash"]]));

    spec.startTurn("Implement a different feature for the billing flow", false);

    expect(spec.turnBaseline).toBeUndefined();
  });

  it("drops the active spec when the user rejects it at the approval gate", () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement a new feature for the billing flow", true);
    expect(spec.activeSpec?.approvalStatus).toBe("pending");

    spec.rejectActiveSpec();

    // Nothing left to verify, so agent_end reports no results at all — the user
    // sees no wall of red ✗ for criteria they deliberately prevented.
    expect(spec.activeSpec).toBeUndefined();
    expect(spec.verify()).toEqual([]);
    expect(spec.finishTurn([])).toEqual([]);
  });

  it("stops collecting evidence once the spec is rejected", () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement a new feature for the billing flow", true);
    spec.rejectActiveSpec();

    spec.recordEvidence(MANUAL_EV);

    expect(spec.verify()).toEqual([]);
  });

  it("is a no-op when there is no active spec to reject", () => {
    const spec = new SpecEngine();
    expect(() => spec.rejectActiveSpec()).not.toThrow();
    expect(spec.activeSpec).toBeUndefined();
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
