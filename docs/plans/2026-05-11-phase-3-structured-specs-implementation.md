# Phase 3 Structured Specs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace heuristic acceptance criteria with structured JSON specs that describe scope, allowed capabilities, risks, and evidence requirements.

**Architecture:** Keep `SpecEngine`, but change `FormalSpec` into a structured object with stable criterion IDs and explicit `evidenceRequired`. Generation remains deterministic in v1, but produces richer data that later verification can inspect.

**Tech Stack:** TypeScript, existing `src/spec/*`, `vitest`.

---

## Mental Model

A spec is not a summary of the prompt. It is a contract: what can change, what evidence proves it, and what risks need attention.

---

## Task 1: Redesign Spec Types

**Files:**
- Modify: `agent/extensions/harness/src/spec/types.ts`
- Test: `agent/extensions/harness/tests/spec/types.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, expect, it } from "vitest";
import type { FormalSpec } from "../../src/spec/types";

describe("FormalSpec", () => {
  it("supports structured evidence requirements", () => {
    const spec: FormalSpec = {
      id: "spec-1",
      tier: "ambient",
      status: "active",
      approvalStatus: "not_required",
      goal: "add pagination",
      allowedCapabilities: ["read", "edit"],
      targetFiles: ["src/**"],
      risks: ["data loading changes"],
      acceptanceCriteria: [
        {
          id: "criterion-1",
          statement: "Pagination is implemented",
          evidenceRequired: ["diff", "test"],
        },
      ],
      createdAt: 0,
    };

    expect(spec.acceptanceCriteria[0].evidenceRequired).toContain("test");
  });
});
```

**Step 2: Update types**

Add:
- `EvidenceRequirement = "diff" | "test" | "command" | "manual"`
- `StructuredCriterion`
- `allowedCapabilities: Capability[]`

Keep compatibility aliases only where existing tests need migration.

**Step 3: Run test**

```bash
cd agent/extensions/harness
npm test -- tests/spec/types.test.ts
```

Expected: PASS after updating affected spec tests.

---

## Task 2: Generate Structured Criteria

**Files:**
- Modify: `agent/extensions/harness/src/spec/generator.ts`
- Test: `agent/extensions/harness/tests/spec/generator.test.ts`

**Step 1: Write failing test**

```typescript
it("generates structured criteria for implementation tasks", () => {
  const spec = generateSpec("add a pagination feature with tests", "ambient");
  expect(spec.allowedCapabilities).toContain("edit");
  expect(spec.acceptanceCriteria[0].id).toMatch(/^criterion-/);
  expect(spec.acceptanceCriteria.some((c) => c.evidenceRequired.includes("test"))).toBe(true);
});
```

**Step 2: Implement deterministic generation**

Rules:
- `add`, `implement`, `build`, `create` -> require `diff`
- `test`, `spec`, `verify` -> require `test`
- `migrate`, `refactor` -> require `diff` and `command`
- default ambient -> require `manual`

**Step 3: Run tests**

```bash
npm test -- tests/spec/generator.test.ts tests/spec/engine.test.ts
```

Expected: PASS.

---

## Task 3: Add Scope to Explicit Spec Approval

**Files:**
- Modify: `agent/extensions/harness/src/index.ts`
- Test: `agent/extensions/harness/tests/hooks/before-tool.test.ts`

**Step 1: Add failing test**

Assert explicit approval text includes:
- goal
- allowed capabilities
- target files
- acceptance criteria
- evidence requirements

**Step 2: Update `formatSpecForApproval`**

Format as a short review:

```text
Goal: ...
Allowed capabilities: read, edit
Target files: src/**
Evidence required:
  - criterion-1: diff, test
Approve?
```

**Step 3: Run tests**

```bash
npm test -- tests/hooks/before-tool.test.ts
```

Expected: PASS.

---

## Task 4: Enforce Explicit Spec Capability Scope

**Files:**
- Modify: `agent/extensions/harness/src/hooks/before-tool.ts`
- Test: `agent/extensions/harness/tests/hooks/before-tool.test.ts`

**Step 1: Add failing test**

Create explicit spec with `allowedCapabilities: ["read", "edit"]`. Attempt `bash`. Expect block before permission prompt.

**Step 2: Implement**

After spec approval and before permission evaluation, if active spec is explicit and `capability` is outside `allowedCapabilities`, block with visible reason:

```text
Blocked by explicit spec scope: exec is not allowed for this task
```

**Step 3: Run tests**

```bash
npm test -- tests/hooks/before-tool.test.ts
```

Expected: PASS.

---

## Task 5: Update README With Structured Spec Teaching Section

**Files:**
- Modify: `agent/extensions/harness/README.md`

**Step 1: Add question-led section**

```markdown
### What does a spec approve?

A spec approves scope, not vibes. Harness records the goal, allowed capabilities, target files, risks, and evidence required for each criterion.

```json
{
  "id": "criterion-1",
  "statement": "Pagination is implemented",
  "evidenceRequired": ["diff", "test"]
}
```
```

**Step 2: Verify Markdown**

```bash
sed -n '1,320p' README.md
```

Expected: section is readable and concise.

---

## Final Verification

Run:

```bash
cd agent/extensions/harness
npm test
node ./node_modules/typescript/bin/tsc --noEmit
```

Expected:
- Specs use structured criteria.
- Explicit approval shows scope and evidence.
- Explicit specs block out-of-scope capabilities.
