import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceFromToolResult, type ToolResultEventLike } from "../../src/spec/evidence";
import { generateSpec } from "../../src/spec/generator";
import { verifyCriteria } from "../../src/spec/verification";
import { shouldReinject } from "../../src/spec/gate";
import type { EvidenceRecord } from "../../src/spec/claims";
import type { FormalSpec } from "../../src/spec/types";

/**
 * The seam between evidence collection and verification.
 *
 * `evidence.test.ts` tests `evidenceFromToolResult` alone; `verification.test.ts`
 * tests `verifyCriteria` against hand-written `EvidenceRecord` literals with clean
 * repo-relative paths and pre-set `kind` fields. Both are green, and both were
 * green while the harness could not recognize its own test command or a diff at
 * an absolute path — because nothing drove a *real* tool result through the
 * recognizer into the verifier.
 *
 * These tests never construct an `EvidenceRecord` by hand. They build pi-shaped
 * `tool_result` events, run them through `evidenceFromToolResult`, and assert on
 * the resulting `VerificationResult`.
 *
 * Several of these were first committed as `it.fails` — passing precisely
 * because the assertion inside them threw — and were flipped to `it` by the task
 * that fixed each defect. Each one therefore records a bug that actually shipped,
 * not a hypothetical.
 */

/** A pi `tool_result` event, shaped as the SDK emits it. */
function toolResult(
  toolName: string,
  input: Record<string, unknown>,
  opts: { isError?: boolean } = {},
): ToolResultEventLike {
  return {
    type: "tool_result",
    toolCallId: `call-${Math.random().toString(36).slice(2, 8)}`,
    toolName,
    input,
    content: [{ type: "text", text: opts.isError ? "command failed" : "ok" }],
    isError: opts.isError ?? false,
  };
}

/** Drive events through the recognizer exactly as `SpecEngine.recordToolResult` does. */
function collect(events: ToolResultEventLike[]): EvidenceRecord[] {
  return events
    .map((event) => evidenceFromToolResult(event))
    .filter((record): record is EvidenceRecord => record !== undefined);
}

function resultFor(spec: FormalSpec, criterionId: string, events: ToolResultEventLike[]) {
  const results = verifyCriteria(spec, collect(events));
  const match = results.find((result) => result.criterion.id === criterionId);
  if (!match) throw new Error(`no criterion ${criterionId} in [${results.map((r) => r.criterion.id).join(", ")}]`);
  return match;
}

describe("evidence seam: command recognition", () => {
  // No auth/billing/session token in the prompt, so `expectedArgs` and `targets`
  // stay empty and this exercises runner recognition in isolation.
  const spec = () => generateSpec("Add pagination with tests", "ambient");

  it("recognizes a bare runner invocation", () => {
    const result = resultFor(spec(), "build-tests", [toolResult("bash", { command: "vitest run" })]);
    expect(result.passed).toBe(true);
  });

  // `package.json` declares `"test": "vitest run"`, and this project must be run as
  // `bun run test`. Before Task 4, classifyTestCommand required argv[1] === "test",
  // saw "run", and filed this as generic command evidence — so the criterion that
  // demands `test` evidence could never be satisfied on this repo.
  it("satisfies a test criterion from `bun run test`", () => {
    const result = resultFor(spec(), "build-tests", [toolResult("bash", { command: "bun run test" })]);
    expect(result.passed).toBe(true);
  });

  it("classifies package-manager and wrapper invocations as test evidence", () => {
    for (const command of ["npm test", "pnpm test", "yarn test", "npx vitest run", "cd packages/core && vitest run"]) {
      const evidence = evidenceFromToolResult(toolResult("bash", { command }));
      expect(evidence?.kind, command).toBe("test");
    }
  });

  // `bun test` invokes bun's own built-in runner, not the package script — the two
  // must never be conflated, since this repo reports phantom failures under it.
  it("does not resolve bare `bun test` through package.json scripts", () => {
    const evidence = evidenceFromToolResult(toolResult("bash", { command: "bun test" }));
    expect(evidence?.kind).toBe("test");
    if (evidence?.kind === "test") expect(evidence.runner).toBe("bun test");
  });

  it("finds a test run buried inside an aggregate script", () => {
    // "ci": "bun run typecheck && bun run lint && bun run test"
    const evidence = evidenceFromToolResult(toolResult("bash", { command: "bun run ci" }));
    expect(evidence?.kind).toBe("test");
  });

  it("does not accept a trivially-satisfiable command as verification", () => {
    // `fix` carries evidence ["diff"] + evidenceAnyOf [["test","command"]]: the
    // change must land AND be verified somehow. `echo` is not verification.
    const fixSpec = generateSpec("Fix the pagination off-by-one error", "ambient");
    const result = resultFor(fixSpec, "fix-primary", [
      toolResult("write", { path: "src/pagination.ts" }),
      toolResult("bash", { command: "echo done" }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.missingEvidence).toContain("test|command");
  });

  it("does not count a failing command as evidence", () => {
    const result = resultFor(spec(), "build-tests", [
      toolResult("bash", { command: "vitest run" }, { isError: true }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.missingEvidence).toContain("test (failed)");
  });
});

describe("evidence seam: path binding", () => {
  // "billing" makes inferTargets emit ["src/billing", "tests/billing"], so diff
  // evidence must actually bind to a target rather than short-circuiting on an
  // empty target list.
  const spec = () => generateSpec("Add a pagination helper to the billing module", "ambient");

  it("binds a repo-relative edit to its target", () => {
    const result = resultFor(spec(), "build-primary", [toolResult("write", { path: "src/billing/pagination.ts" })]);
    expect(result.passed).toBe(true);
  });

  // pi's edit/write schema declares `path` as "relative or absolute", and models
  // routinely send absolute. Before Task 5 the recognizer stored whatever arrived,
  // so an absolute path matched none of pathsMatchTargets' three clauses and the
  // diff was silently discarded.
  it("binds an absolute-path edit to its target", () => {
    const absolute = join(process.cwd(), "src/billing/pagination.ts");
    const result = resultFor(spec(), "build-primary", [toolResult("write", { path: absolute })]);
    expect(result.passed).toBe(true);
  });

  it("binds a ./-prefixed edit to its target", () => {
    const result = resultFor(spec(), "build-primary", [toolResult("edit", { path: "./src/billing/pagination.ts" })]);
    expect(result.passed).toBe(true);
  });

  it("produces no evidence for an edit outside the repo", () => {
    // Contract targets are always repo-relative, so such a path could never match
    // one — recording it would only add an unmatchable record to the evidence set.
    expect(evidenceFromToolResult(toolResult("write", { path: "/etc/passwd" }))).toBeUndefined();
  });

  it("does not bind an edit outside the target tree", () => {
    const result = resultFor(spec(), "build-primary", [toolResult("write", { path: "src/unrelated/thing.ts" })]);
    expect(result.passed).toBe(false);
    expect(result.missingEvidence).toContain("diff");
  });
});

describe("evidence seam: advisory criteria never drive the gate", () => {
  it("reports an unmet audit criterion without re-injecting", () => {
    const spec = generateSpec("Audit the permission surface for gaps", "ambient");
    const results = verifyCriteria(spec, collect([]));
    const audit = results.find((result) => result.criterion.id === "audit-primary");

    expect(audit?.passed).toBe(false);
    expect(audit?.advisory).toBe(true);
    expect(shouldReinject({
      results,
      attempts: 0,
      isSubagent: false,
      enabled: true,
      goalActive: false,
      specApproved: true,
    })).toBe(false);
  });
});

describe("evidence seam: what counts as verification", () => {
  const spec = () => generateSpec("Fix the pagination off-by-one error", "ambient");

  // Inspection and printing are not verification. Kept as a denylist rather than
  // an allowlist on purpose: over-rejecting real evidence sends the gate back
  // into the retry loop this whole plan exists to remove, so an unrecognized
  // command — far more likely a real build tool than a trick — still counts.
  it("rejects commands that only inspect or print", () => {
    for (const command of ["echo ok", "printf done", "true", "cat src/x.ts", "ls -la", "rg pattern", "find . -name x", "git grep foo", "wc -l src/x.ts"]) {
      const result = resultFor(spec(), "fix-primary", [
        toolResult("write", { path: "src/pagination.ts" }),
        toolResult("bash", { command }),
      ]);
      expect(result.passed, command).toBe(false);
    }
  });

  it("accepts a real verification command", () => {
    for (const command of ["tsc --noEmit", "eslint src", "cargo build", "make check"]) {
      const result = resultFor(spec(), "fix-primary", [
        toolResult("write", { path: "src/pagination.ts" }),
        toolResult("bash", { command }),
      ]);
      expect(result.passed, command).toBe(true);
    }
  });

  it("accepts an unrecognized command rather than guessing it is a trick", () => {
    const result = resultFor(spec(), "fix-primary", [
      toolResult("write", { path: "src/pagination.ts" }),
      toolResult("bash", { command: "some-project-specific-verifier --strict" }),
    ]);
    expect(result.passed).toBe(true);
  });

  // The rejection is scoped to gated criteria. For an advisory audit the command
  // corroborates analysis rather than standing in as proof, and inspection is the
  // entire point — an audit's evidence genuinely is ripgrep.
  it("accepts inspection commands as corroboration for an advisory criterion", () => {
    const auditSpec = generateSpec("audit the auth flow", "ambient");
    for (const command of ["rg token src/auth", "grep -r token src/auth", "cat src/auth/session.ts"]) {
      const result = resultFor(auditSpec, "audit-primary", [toolResult("bash", { command })]);
      expect(result.passed, command).toBe(true);
    }
  });
});
