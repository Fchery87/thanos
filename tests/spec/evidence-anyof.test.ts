import { describe, expect, it } from "vitest";
import { generateSpec } from "../../src/spec/generator";
import { verifyCriteria } from "../../src/spec/verification";
import { shouldReinject } from "../../src/spec/gate";
import type { EvidenceRecord } from "../../src/spec/claims";

/**
 * W4: a mutating criterion's verification slot is now "test OR command" via an
 * anyOf group, instead of a pre-guessed single kind. Previously "fix X" (no
 * "test" in the prompt) demanded `command` evidence specifically, so an agent
 * that verified by running the test suite produced a false negative and the gate
 * looped. These pin that both verification shapes satisfy the criterion, while a
 * bare diff with no verification still (correctly) re-injects.
 */
const diff = (path: string): EvidenceRecord => ({ kind: "diff", paths: [path], base: "", patchHash: "", passed: true });
const test: EvidenceRecord = { kind: "test", runner: "bun test", normalizedExecutable: "bun test", args: [], exitCode: 0, passed: true };
const command: EvidenceRecord = { kind: "command", family: "", normalizedExecutable: "make", argv: ["make", "check"], exitCode: 0, passed: true };

const gate = (results: ReturnType<typeof verifyCriteria>) =>
  shouldReinject({ results, attempts: 0, isSubagent: false, enabled: true, goalActive: false, specApproved: true });

describe("anyOf evidence for mutating criteria", () => {
  it("accepts a fix verified by a test even though the prompt never said 'test'", () => {
    const spec = generateSpec("fix the login bug", "ambient");
    const results = verifyCriteria(spec, [diff("src/login.ts"), test]);

    expect(results.every((result) => result.passed)).toBe(true);
    expect(gate(results)).toBe(false);
  });

  it("accepts the same fix verified by a command instead", () => {
    const spec = generateSpec("fix the login bug", "ambient");
    const results = verifyCriteria(spec, [diff("src/login.ts"), command]);

    expect(results.every((result) => result.passed)).toBe(true);
    expect(gate(results)).toBe(false);
  });

  // The anyOf group is still reported unmet — that is what this file covers.
  // Phase 0 changed only what the GATE does with it: this contract is a
  // deterministic keyword template ("fix" matched a regex, nothing more), so it
  // is surfaced in the turn panel but no longer buys itself an extra model turn.
  it("reports the unmet anyOf group for a fix that ran no verification at all", () => {
    const spec = generateSpec("fix the login bug", "ambient");
    const results = verifyCriteria(spec, [diff("src/login.ts")]);

    expect(results.some((result) => !result.passed)).toBe(true);
    const unmet = results.flatMap((result) => result.missingEvidence);
    expect(unmet).toContain("test|command");

    expect(gate(results)).toBe(false);
  });
});
