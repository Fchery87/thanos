import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractTaskContract } from "../../src/spec/contract-extractor";
import { validateTaskContract } from "../../src/spec/contract-schema";

describe("task contract extraction", () => {
  it("accepts a valid structured contract candidate", () => {
    const contract = extractTaskContract("Rename getCwd to getCurrentWorkingDirectory across the repo", {
      tier: "ambient",
      candidate: {
        objective: "Rename getCwd to getCurrentWorkingDirectory across the repo",
        criteria: [{
          id: "rename-primary",
          kind: "rename",
        statement: "Rename getCwd consistently across the repo",
        targets: ["src"],
        evidence: ["diff"],
        expectedExecutables: [],
        expectedArgs: [],
        mustNot: [],
        source: "semantic_extraction",
      }],
      },
    });

    expect(contract.criteria[0]?.kind).toBe("rename");
    expect(contract.criteria[0]?.source).toBe("semantic_extraction");
  });

  it("falls back to deterministic extraction when the candidate is invalid", () => {
    const contract = extractTaskContract("Fix the failing session timeout bug and verify it", {
      tier: "ambient",
      candidate: {
        objective: "Fix the failing session timeout bug and verify it",
        criteria: [{ kind: "invented" }],
      },
    });

    expect(contract.criteria.some((criterion) => criterion.kind === "fix")).toBe(true);
    expect(contract.criteria.every((criterion) => criterion.source === "deterministic_fallback")).toBe(true);
  });

  it("falls back to deterministic extraction when the semantic candidate omits the objective", () => {
    const contract = extractTaskContract("Audit the auth flow for security issues", {
      tier: "explicit",
      extractCandidate: () => ({
        criteria: [{
          id: "audit-primary",
          kind: "audit",
          statement: "Audit the auth flow",
          targets: ["src/auth"],
          evidence: ["manual"],
          expectedExecutables: [],
          expectedArgs: [],
          mustNot: [],
          source: "semantic_extraction",
        }],
      }),
    });

    expect(contract.criteria.every((criterion) => criterion.source === "deterministic_fallback")).toBe(true);
  });

  it("validates the checked-in fixture dataset", () => {
    const dataset = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/contracts/requests.json"), "utf-8")) as Array<{
      prompt: string;
      expectedKinds: string[];
      forbiddenKinds: string[];
    }>;

    for (const item of dataset) {
      const contract = extractTaskContract(item.prompt);
      for (const expected of item.expectedKinds) {
        expect(contract.criteria.some((criterion) => criterion.kind === expected)).toBe(true);
      }
      for (const forbidden of item.forbiddenKinds) {
        expect(contract.criteria.some((criterion) => criterion.kind === forbidden)).toBe(false);
      }
      expect(validateTaskContract(contract)).toBeTruthy();
    }
  });

  it("uses a semantic candidate path for ambient tasks and falls back when it invents invalid fields", () => {
    const contract = extractTaskContract("Secure the auth flow and verify policy behavior", {
      tier: "ambient",
      extractCandidate: () => ({
        objective: "Secure the auth flow and verify policy behavior",
        criteria: [{
          id: "secure-primary",
          kind: "secure",
          statement: "Secure the auth flow and verify policy behavior",
          targets: ["src/auth"],
          evidence: ["diff", "test"],
          expectedExecutables: ["vitest"],
          expectedArgs: ["auth"],
          mustNot: [],
          source: "semantic_extraction",
        }],
      }),
    });

    expect(contract.criteria[0]?.source).toBe("semantic_extraction");
  });

  it("falls back when the semantic extractor invents invalid evidence identities", () => {
    const contract = extractTaskContract("Audit the auth flow for security issues", {
      tier: "explicit",
      extractCandidate: () => ({
        objective: "Audit the auth flow for security issues",
        criteria: [{
          id: "audit-primary",
          kind: "audit",
          statement: "Audit the auth flow",
          targets: ["src/auth"],
          evidence: ["network"],
          expectedExecutables: [],
          expectedArgs: [],
          mustNot: [],
          source: "semantic_extraction",
        }],
      }),
    });

    expect(contract.criteria.every((criterion) => criterion.source === "deterministic_fallback")).toBe(true);
  });

  it("falls back when the semantic extractor invents an impossible target path", () => {
    const contract = extractTaskContract("Build a billing dashboard with tests and docs", {
      tier: "ambient",
      extractCandidate: () => ({
        objective: "Build a billing dashboard with tests and docs",
        criteria: [{
          id: "build-primary",
          kind: "build",
          statement: "Build a billing dashboard",
          targets: ["../../secrets"],
          evidence: ["diff"],
          expectedExecutables: [],
          expectedArgs: [],
          mustNot: [],
          source: "semantic_extraction",
        }],
      }),
    });

    expect(contract.criteria.every((criterion) => criterion.source === "deterministic_fallback")).toBe(true);
  });

  it("falls back when the semantic extractor invents an impossible executable", () => {
    const contract = extractTaskContract("Build a billing dashboard with tests and docs", {
      tier: "ambient",
      extractCandidate: () => ({
        objective: "Build a billing dashboard with tests and docs",
        criteria: [{
          id: "build-primary",
          kind: "build",
          statement: "Build a billing dashboard",
          targets: ["src/billing"],
          evidence: ["test"],
          expectedExecutables: ["rm -rf"],
          expectedArgs: [],
          mustNot: [],
          source: "semantic_extraction",
        }],
      }),
    });

    expect(contract.criteria.every((criterion) => criterion.source === "deterministic_fallback")).toBe(true);
  });

  it("falls back when the semantic extractor returns no candidate at all", () => {
    const contract = extractTaskContract("Build a billing dashboard with tests and docs", {
      tier: "ambient",
      extractCandidate: () => undefined,
    });

    expect(contract.criteria.some((criterion) => criterion.kind === "build")).toBe(true);
    expect(contract.criteria.every((criterion) => criterion.source === "deterministic_fallback")).toBe(true);
  });
});
