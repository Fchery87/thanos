import { describe, expect, it } from "vitest";
import { buildTaskContract } from "../../src/spec/task-contract";

describe("buildTaskContract", () => {
  it("represents rename requests without falling back to a generic manual criterion", () => {
    const contract = buildTaskContract("Rename getCwd to getCurrentWorkingDirectory across the repo");

    expect(contract.criteria).not.toHaveLength(0);
    expect(contract.criteria.some((criterion) => criterion.kind === "rename")).toBe(true);
    expect(contract.criteria.every((criterion) => criterion.evidence.length > 0)).toBe(true);
    expect(contract.criteria.some((criterion) => criterion.evidence.includes("diff"))).toBe(true);
    expect(contract.criteria.every((criterion) => criterion.source === "deterministic_fallback")).toBe(true);
    expect(contract.criteria.some((criterion) => criterion.statement.toLowerCase().includes("rename"))).toBe(true);
    expect(contract.criteria.every((criterion) => Array.isArray(criterion.expectedExecutables))).toBe(true);
    expect(contract.criteria.every((criterion) => Array.isArray(criterion.expectedArgs))).toBe(true);
  });

  it("represents fix requests as behavioral repairs with diff and verification evidence", () => {
    const contract = buildTaskContract("Fix the failing session timeout bug and verify it");

    expect(contract.criteria.some((criterion) => criterion.kind === "fix")).toBe(true);
    expect(contract.criteria.some((criterion) => criterion.evidence.includes("diff"))).toBe(true);
    expect(contract.criteria.some((criterion) => criterion.evidence.includes("test") || criterion.evidence.includes("command"))).toBe(true);
    expect(contract.criteria.some((criterion) => criterion.expectedArgs.includes("session"))).toBe(true);
  });

  it("represents audit requests as read-only verification work", () => {
    const contract = buildTaskContract("Audit the auth flow for security issues");

    expect(contract.criteria.some((criterion) => criterion.kind === "audit")).toBe(true);
    expect(contract.criteria.every((criterion) => !criterion.evidence.includes("diff"))).toBe(true);
    expect(contract.criteria.every((criterion) => criterion.source === "deterministic_fallback")).toBe(true);
    expect(contract.criteria.every((criterion) => criterion.expectedExecutables.length > 0)).toBe(true);
  });

  it("represents investigate requests without collapsing to generic manual-only proof", () => {
    const contract = buildTaskContract("Investigate why the billing worker hangs in CI");

    expect(contract.criteria.some((criterion) => criterion.kind === "investigate")).toBe(true);
    expect(contract.criteria.every((criterion) => criterion.statement.length > 0)).toBe(true);
    expect(contract.criteria.some((criterion) => criterion.evidence.includes("manual") || criterion.evidence.includes("command"))).toBe(true);
    expect(contract.criteria.every((criterion) => criterion.expectedExecutables.length > 0)).toBe(true);
  });

  it("represents secure requests as trust-boundary work with evidence from diff and command checks", () => {
    const contract = buildTaskContract("Secure the auth flow and verify policy behavior");

    expect(contract.criteria.some((criterion) => criterion.kind === "secure")).toBe(true);
    expect(contract.criteria.some((criterion) => criterion.evidence.includes("diff"))).toBe(true);
    expect(contract.criteria.some((criterion) => criterion.evidence.includes("command") || criterion.evidence.includes("test"))).toBe(true);
    expect(contract.criteria.some((criterion) => criterion.targets.includes("src/auth"))).toBe(true);
    expect(contract.criteria.some((criterion) => criterion.mustNot.includes("log session tokens"))).toBe(true);
    expect(contract.criteria.some((criterion) => criterion.expectedArgs.includes("auth"))).toBe(true);
  });
});
