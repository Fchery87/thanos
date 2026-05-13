# Phase 5 Subagent Governance And Docs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make subagents governed by parent policy ceilings, add bounded execution controls, structured subagent results, policy-safe transcript retention, and finish with policy-first teaching docs.

**Architecture:** Extend `task` execution so the parent policy is passed to subagents as a ceiling. Add timeout and max-turn settings to agent metadata. Parse structured result metadata from subagent output when present, while preserving final text for user-facing output. Retain transcript metadata without storing protected contents.

**Tech Stack:** TypeScript, Node child process APIs, existing agent loader/task tool, existing policy/audit/spec modules, `vitest`, Markdown docs.

---

## Mental Model

Subagents amplify the parent. They can narrow authority, but never expand it.

---

## Task 1: Add Subagent Policy Ceiling Types

**Files:**
- Create: `agent/extensions/harness/src/agents/policy.ts`
- Test: `agent/extensions/harness/tests/agents/policy.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, expect, it } from "vitest";
import { narrowPolicyForAgent } from "../../src/agents/policy";

describe("narrowPolicyForAgent", () => {
  it("keeps ask agents read-only", () => {
    const policy = narrowPolicyForAgent("ask", {
      version: 1,
      preset: "team",
      audit: { enabled: true },
      headless: { defaultDecision: "deny" },
      rules: [{ id: "allow-edit", capability: "edit", decision: "allow", reason: "parent allow" }],
    });

    expect(policy.rules.some((rule) => rule.id === "subagent-deny-edit")).toBe(true);
  });
});
```

**Step 2: Implement**

For `ask` and `plan`, append deny rules for `edit`, `exec`, and `task`. For `build`, inherit parent policy plus deny `task`.

**Step 3: Run tests**

```bash
cd agent/extensions/harness
npm test -- tests/agents/policy.test.ts
```

Expected: PASS.

---

## Task 2: Pass Parent Policy To Subagents

**Files:**
- Modify: `agent/extensions/harness/src/agents/task-tool.ts`
- Modify: `agent/extensions/harness/src/index.ts`
- Test: `agent/extensions/harness/tests/agents/task-tool.test.ts`

**Step 1: Add failing test**

Mock spawn args/env and assert a temp policy path or env var is passed to child process.

**Step 2: Implement**

Write narrowed policy JSON to the subagent temp directory and pass:

```bash
HARNESS_POLICY_FILE=<tmp>/harness.policy.json
```

Update policy loader to prefer `HARNESS_POLICY_FILE` when present.

**Step 3: Run tests**

```bash
npm test -- tests/agents/task-tool.test.ts tests/policy/loader.test.ts
```

Expected: PASS.

---

## Task 3: Add Timeout And Max-turn Controls

**Files:**
- Modify: `agent/extensions/harness/src/agents/loader.ts`
- Modify: `agent/extensions/harness/src/agents/task-tool.ts`
- Modify: `agent/extensions/harness/agents/ask.md`
- Modify: `agent/extensions/harness/agents/plan.md`
- Modify: `agent/extensions/harness/agents/build.md`
- Test: `agent/extensions/harness/tests/agents/loader.test.ts`
- Test: `agent/extensions/harness/tests/agents/task-tool.test.ts`

**Step 1: Add failing loader test**

Assert frontmatter can parse:

```yaml
timeoutMs: 120000
maxTurns: 8
```

**Step 2: Implement**

Add optional metadata fields to agent loader result. In `executeTask`, set a timer that kills child with `SIGTERM` when timeout expires. If Pi supports a max-turn CLI flag, pass it; otherwise include max-turn instruction in appended system prompt.

**Step 3: Run tests**

```bash
npm test -- tests/agents/loader.test.ts tests/agents/task-tool.test.ts
```

Expected: PASS.

---

## Task 4: Add Structured Subagent Result Metadata

**Files:**
- Create: `agent/extensions/harness/src/agents/result.ts`
- Modify: `agent/extensions/harness/src/agents/task-tool.ts`
- Test: `agent/extensions/harness/tests/agents/result.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, expect, it } from "vitest";
import { parseSubagentResult } from "../../src/agents/result";

describe("parseSubagentResult", () => {
  it("extracts structured metadata from final text", () => {
    const result = parseSubagentResult('Done\n```json\n{"status":"success","filesTouched":["src/a.ts"],"testsRun":["npm test"],"risks":[]}\n```');
    expect(result.metadata?.status).toBe("success");
  });
});
```

**Step 2: Implement**

Parse the last fenced JSON block if it has `status`. Return `{ text, metadata }`. Preserve original final text if parsing fails.

**Step 3: Run tests**

```bash
npm test -- tests/agents/result.test.ts tests/agents/task-tool.test.ts
```

Expected: PASS.

---

## Task 5: Retain Transcript Metadata Safely

**Files:**
- Create: `agent/extensions/harness/src/agents/transcripts.ts`
- Modify: `agent/extensions/harness/src/agents/task-tool.ts`
- Test: `agent/extensions/harness/tests/agents/transcripts.test.ts`

**Step 1: Write failing test**

Assert transcript metadata records:
- agent type
- start/end timestamps
- status
- output summary
- no raw sensitive content

**Step 2: Implement**

Store metadata under `.harness/subagents/<timestamp>-<type>.json`. Do not store raw stdout by default. Store transcript path in audit event if useful.

**Step 3: Run tests**

```bash
npm test -- tests/agents/transcripts.test.ts tests/agents/task-tool.test.ts
```

Expected: PASS.

---

## Task 6: Write Policy-first Docs

**Files:**
- Modify: `agent/extensions/harness/README.md`
- Create: `agent/extensions/harness/docs/policy.md`
- Create: `agent/extensions/harness/docs/subagents.md`
- Create: `agent/extensions/harness/docs/specs.md`

**Step 1: Add docs using the approved teaching style**

Each section answers one question:
- What files should the agent never read?
- What happens when policy blocks a tool?
- How do I control network commands?
- What does a spec approve?
- How does Harness know the work is done?
- What can a subagent do?

Each answer includes:
- one mental model
- one tiny JSON example
- failure behavior

**Step 2: Verify docs**

```bash
find docs -maxdepth 1 -type f -print
sed -n '1,220p' docs/policy.md
sed -n '1,220p' docs/subagents.md
sed -n '1,220p' docs/specs.md
```

Expected: docs are readable, concrete, and avoid feature-list prose.

---

## Final Verification

Run:

```bash
cd agent/extensions/harness
npm test
node ./node_modules/typescript/bin/tsc --noEmit
sed -n '1,260p' README.md
```

Expected:
- Subagents inherit parent policy as a ceiling.
- Ask and plan subagents are read-only.
- Build subagents cannot delegate recursively.
- Subagents have bounded runtime.
- Structured result metadata is parsed when present.
- Transcript metadata is retained without raw sensitive content.
- Docs teach policy with concrete questions and small examples.
