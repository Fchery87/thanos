import { describe, expect, it } from "vitest";
import { validateTaskContract, validateTaskContractDetailed } from "../../src/spec/contract-schema";

/**
 * The schema that rejected 48 consecutive extractions.
 *
 * Two independent causes, both pinned here so neither can come back: the prompt
 * told the model to omit optional fields while the schema treated omission as
 * malformed, and `VALID_TARGET` was a directory whitelist that rejected most of
 * this repo. What must NOT change is the malformed-present-value boundary and
 * the path-escape rejection — those are load-bearing, and the loosening below
 * is only about omission and directory taste.
 */
const criterion = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  kind: "build",
  statement: "Pagination lands in the listing module",
  evidence: ["diff"],
  source: "semantic_extraction",
  ...over,
});

const contract = (over: Record<string, unknown> = {}) => ({
  objective: "Add pagination",
  criteria: [criterion(over)],
});

describe("optional arrays: omission is not malformation", () => {
  // Case (A) of the plan's evidence table. This is the whole 0-for-48.
  it("accepts a criterion that omits every optional array, as the prompt instructs", () => {
    expect(validateTaskContract(contract())).toBeDefined();
  });

  it("still accepts one that supplies them explicitly", () => {
    expect(validateTaskContract(contract({
      targets: [], expectedExecutables: [], expectedArgs: [], mustNot: [],
    }))).toBeDefined();
  });

  it("treats an omitted array as empty rather than absent", () => {
    const result = validateTaskContract(contract());
    expect(result?.criteria[0]).toMatchObject({
      targets: [], expectedExecutables: [], expectedArgs: [], mustNot: [],
    });
  });

  it.each([
    ["a bare string", "src"],
    ["an array of non-strings", [123]],
    ["an array with an empty string", [""]],
    ["an over-long array", Array.from({ length: 20 }, (_, i) => `src/p${i}`)],
  ])("still rejects targets given as %s", (_label, targets) => {
    expect(validateTaskContract(contract({ targets }))).toBeUndefined();
  });
});

describe("targets: a path-escape boundary, not a directory whitelist", () => {
  it.each([
    "agent/settings.json",   // case (C) — rejected by the old whitelist
    ".harness/evolution",
    "evals/prompts",
    "package.json",
    "docs/adr/0006-completion-verification-gate.md",
    "src/auth",              // case (D) — the only shape that used to work
    "a/b/c.ts",
  ])("accepts the repo-relative path %s", (target) => {
    expect(validateTaskContract(contract({ targets: [target] }))).toBeDefined();
  });

  it("normalizes a trailing slash rather than rejecting it", () => {
    const result = validateTaskContract(contract({ targets: ["src/spec/"] }));
    expect(result?.criteria[0]?.targets).toEqual(["src/spec"]);
  });

  it.each([
    ["parent traversal", "../../etc/passwd"],
    ["absolute posix", "/etc/passwd"],
    ["traversal mid-path", "src/../../../etc"],
    ["windows drive", "C:\\Windows\\System32"],
    ["UNC share", "\\\\server\\share"],
    ["repo root, which matches no path", "."],
    ["embedded NUL", "src/\u0000passwd"],
  ])("rejects %s", (_label, target) => {
    expect(validateTaskContract(contract({ targets: [target] }))).toBeUndefined();
  });
});

describe("vacuous criteria", () => {
  // A criterion with an empty verification slot passes unconditionally, which
  // since Phase 0 means the gate silently never fires for that turn.
  it("rejects a criterion with no evidence and no anyOf group", () => {
    expect(validateTaskContract(contract({ evidence: [] }))).toBeUndefined();
  });

  it("accepts an empty evidence list when an anyOf group carries the requirement", () => {
    expect(validateTaskContract(contract({
      evidence: [], evidenceAnyOf: [["test", "command"]],
    }))).toBeDefined();
  });
});

describe("rejection reasons", () => {
  // The diagnostic that would have caught the 0-for-48 on day one.
  it("names the offending criterion and the rule it broke", () => {
    const { contract: accepted, reason } = validateTaskContractDetailed(contract({ targets: ["/etc/passwd"] }));
    expect(accepted).toBeUndefined();
    expect(reason).toContain("criteria[0]");
    expect(reason).toContain("absolute");
  });

  it("reports contract-level shape failures too", () => {
    expect(validateTaskContractDetailed({ objective: "x", criteria: [] }).reason).toBe("criteria is empty");
    expect(validateTaskContractDetailed({ criteria: [criterion()] }).reason).toContain("objective");
    expect(validateTaskContractDetailed(null).reason).toBe("not an object");
  });

  // The reason string reaches the harness ledger, so it must describe the rule
  // and never echo the value that broke it.
  it("does not echo the offending value", () => {
    const { reason } = validateTaskContractDetailed(contract({ targets: ["/etc/shadow"] }));
    expect(reason).not.toContain("/etc/shadow");
  });

  it("carries no reason when the contract is accepted", () => {
    expect(validateTaskContractDetailed(contract()).reason).toBeUndefined();
  });
});
