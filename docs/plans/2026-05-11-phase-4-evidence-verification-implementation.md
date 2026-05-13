# Phase 4 Evidence Verification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Verify specs using concrete evidence from file diffs, command exit codes, test runs, and recorded evidence instead of keyword matching.

**Architecture:** Add an evidence recorder that collects tool results into structured evidence records. Update `verifySpec` to match each criterion against required evidence types. In CI/headless governance mode, unmet criteria produce a failing verification result.

**Tech Stack:** TypeScript, Node built-ins, existing spec engine, existing hooks, `vitest`.

---

## Mental Model

The word "done" is not evidence. A passing test, a changed file, a successful command, or an explicit manual evidence record is evidence.

---

## Task 1: Add Evidence Types

**Files:**
- Create: `agent/extensions/harness/src/spec/evidence.ts`
- Test: `agent/extensions/harness/tests/spec/evidence.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../../src/spec/evidence";

describe("EvidenceRecord", () => {
  it("supports diff, test, command, and manual evidence", () => {
    const evidence: EvidenceRecord = {
      type: "test",
      source: "bash",
      summary: "npm test passed",
      passed: true,
    };

    expect(evidence.type).toBe("test");
  });
});
```

**Step 2: Implement**

```typescript
export type EvidenceType = "diff" | "test" | "command" | "manual";

export interface EvidenceRecord {
  type: EvidenceType;
  source: string;
  summary: string;
  passed: boolean;
  filePath?: string;
  commandFamily?: string;
}
```

**Step 3: Run test**

```bash
cd agent/extensions/harness
npm test -- tests/spec/evidence.test.ts
```

Expected: PASS.

---

## Task 2: Record Evidence From Tool Results

**Files:**
- Modify: `agent/extensions/harness/src/spec/engine.ts`
- Modify: `agent/extensions/harness/src/hooks/after-tool.ts`
- Test: `agent/extensions/harness/tests/hooks/after-tool.test.ts`
- Test: `agent/extensions/harness/tests/spec/engine.test.ts`

**Step 1: Add failing test**

Record a `bash` result with command `npm test` and exit code 0. Expect evidence type `test`.

**Step 2: Implement**

Add `recordEvidence(evidence: EvidenceRecord)` to `SpecEngine`. Keep `recordToolOutput` only if needed for backwards compatibility, but verification should use evidence.

Map tool results:
- `write` or `edit` success -> `diff`
- `bash` with command containing `test`, `vitest`, `pytest`, `playwright` and success -> `test`
- other successful `bash` -> `command`
- explicit manual evidence API can be added later; for now support type only.

**Step 3: Run tests**

```bash
npm test -- tests/hooks/after-tool.test.ts tests/spec/engine.test.ts
```

Expected: PASS.

---

## Task 3: Verify Criteria Against Evidence

**Files:**
- Modify: `agent/extensions/harness/src/spec/verifier.ts`
- Test: `agent/extensions/harness/tests/spec/verifier.test.ts`

**Step 1: Write failing test**

```typescript
it("passes only when required evidence exists and passed", () => {
  const result = verifySpec(
    {
      id: "spec-1",
      tier: "ambient",
      status: "active",
      approvalStatus: "not_required",
      goal: "add tests",
      allowedCapabilities: ["read", "edit", "exec"],
      targetFiles: [],
      risks: [],
      acceptanceCriteria: [{ id: "criterion-1", statement: "Tests pass", evidenceRequired: ["test"] }],
      createdAt: 0,
    },
    [{ type: "test", source: "bash", summary: "vitest passed", passed: true }],
  );

  expect(result[0].passed).toBe(true);
});
```

**Step 2: Implement**

For each criterion, require at least one passed evidence record for every required evidence type.

**Step 3: Run tests**

```bash
npm test -- tests/spec/verifier.test.ts
```

Expected: PASS.

---

## Task 4: Add CI/Headless Verification Failure Mode

**Files:**
- Modify: `agent/extensions/harness/src/spec/types.ts`
- Modify: `agent/extensions/harness/src/index.ts`
- Test: `agent/extensions/harness/tests/spec/engine.test.ts`

**Step 1: Add failing test**

In no-UI/headless mode with unmet criteria, expect the final verification result to expose `severity: "failure"` instead of only warning.

**Step 2: Implement**

Add:

```typescript
export type VerificationSeverity = "info" | "warning" | "failure";
```

In `agent_end`, when `ctx.hasUI` is false and any criterion failed, notify or return failure metadata if Pi supports it. If Pi only supports notifications, include `Spec failed:` in the message and mark warning.

**Step 3: Run tests**

```bash
npm test -- tests/spec/engine.test.ts
```

Expected: PASS.

---

## Task 5: Update README With Evidence Section

**Files:**
- Modify: `agent/extensions/harness/README.md`

**Step 1: Add question-led section**

```markdown
### How does Harness know the work is done?

Harness does not trust completion words. Each spec criterion lists evidence requirements, and verification checks for matching evidence records.

```json
{
  "statement": "Tests cover the new policy behavior",
  "evidenceRequired": ["diff", "test"]
}
```
```

**Step 2: Verify Markdown**

```bash
sed -n '1,380p' README.md
```

Expected: code fences are balanced.

---

## Final Verification

Run:

```bash
cd agent/extensions/harness
npm test
node ./node_modules/typescript/bin/tsc --noEmit
```

Expected:
- Keyword matching is no longer the source of truth.
- Criteria require matching evidence types.
- Interactive unmet criteria warn.
- Headless/CI unmet criteria fail or produce failure-grade output.
