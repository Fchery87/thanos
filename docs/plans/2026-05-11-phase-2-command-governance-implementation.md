# Phase 2 Command Governance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Govern `bash` by command family, destructive-command policy, and network-command policy so execution risk is explicit and auditable.

**Architecture:** Add a command classifier that parses the first executable and maps it to a command family before normal pattern matching. Policy can deny or ask by command family, while audit logs store safe command metadata and a hash of the full command.

**Tech Stack:** TypeScript, Node `crypto`, existing policy evaluator, `vitest`.

---

## Mental Model

Do not ask "is bash allowed?" Ask "which command family is this, what can it affect, and what policy rule governs it?"

---

## Task 1: Add Command Family Classifier

**Files:**
- Create: `agent/extensions/harness/src/commands/classifier.ts`
- Test: `agent/extensions/harness/tests/commands/classifier.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, expect, it } from "vitest";
import { classifyCommand } from "../../src/commands/classifier";

describe("classifyCommand", () => {
  it("classifies package, network, git, destructive, and unknown commands", () => {
    expect(classifyCommand("npm install").family).toBe("package-manager");
    expect(classifyCommand("bun add zod").family).toBe("package-manager");
    expect(classifyCommand("curl https://example.com").family).toBe("network");
    expect(classifyCommand("git push origin main").family).toBe("git");
    expect(classifyCommand("rm -rf .next").family).toBe("destructive");
    expect(classifyCommand("echo hi").family).toBe("unknown");
  });
});
```

**Step 2: Implement classifier**

```typescript
export type CommandFamily = "package-manager" | "network" | "git" | "destructive" | "remote-exec" | "unknown";

export interface CommandClassification {
  family: CommandFamily;
  executable: string;
}

export function classifyCommand(command: string): CommandClassification {
  const executable = command.trim().split(/\s+/)[0] ?? "";
  if (/^(npm|pnpm|yarn|bun|bunx|npx)$/.test(executable)) return { family: "package-manager", executable };
  if (/^(curl|wget)$/.test(executable)) return { family: "network", executable };
  if (executable === "git") return { family: "git", executable };
  if (/^(rm|mv|chmod|chown)$/.test(executable)) return { family: "destructive", executable };
  if (/^(ssh|scp|rsync)$/.test(executable)) return { family: "remote-exec", executable };
  return { family: "unknown", executable };
}
```

**Step 3: Run test**

```bash
cd agent/extensions/harness
npm test -- tests/commands/classifier.test.ts
```

Expected: PASS.

---

## Task 2: Extend Policy Rules With Command Family

**Files:**
- Modify: `agent/extensions/harness/src/policy/types.ts`
- Modify: `agent/extensions/harness/src/policy/schema.ts`
- Modify: `agent/extensions/harness/src/policy/evaluator.ts`
- Test: `agent/extensions/harness/tests/policy/evaluator.test.ts`

**Step 1: Add failing test**

```typescript
it("matches command family rules", () => {
  const result = evaluatePolicy(
    {
      version: 1,
      preset: "team",
      audit: { enabled: true },
      headless: { defaultDecision: "deny" },
      rules: [{ id: "ask-network", capability: "exec", commandFamily: "network", decision: "ask", reason: "Network requires approval" }],
    },
    "exec",
    "curl https://example.com",
  );

  expect(result?.ruleId).toBe("ask-network");
});
```

**Step 2: Implement**

Add optional `commandFamily?: CommandFamily` to `PolicyRule`. In `evaluatePolicy`, when capability is `exec`, call `classifyCommand(target)` and allow a rule to match either `pattern` or `commandFamily`.

**Step 3: Run tests**

```bash
npm test -- tests/policy/schema.test.ts tests/policy/evaluator.test.ts
```

Expected: PASS.

---

## Task 3: Add Built-in Destructive and Network Rules

**Files:**
- Modify: `agent/extensions/harness/src/policy/presets.ts`
- Test: `agent/extensions/harness/tests/policy/presets.test.ts`

**Step 1: Add failing tests**

```typescript
it("team preset requires explicit approval for network command families", () => {
  const policy = getPresetPolicy("team");
  expect(policy.rules.some((rule) => rule.id === "builtin-ask-network-exec")).toBe(true);
});

it("ci preset denies destructive command families", () => {
  const policy = getPresetPolicy("ci");
  expect(policy.rules.some((rule) => rule.id === "builtin-deny-destructive-exec")).toBe(true);
});
```

**Step 2: Implement preset rules**

Add:
- `builtin-ask-network-exec`: `capability: "exec"`, `commandFamily: "network"`, `decision: "ask"`
- `builtin-ask-package-manager-exec`
- `builtin-deny-destructive-exec` for `ci`
- `builtin-ask-remote-exec`

**Step 3: Run tests**

```bash
npm test -- tests/policy/presets.test.ts tests/policy/evaluator.test.ts
```

Expected: PASS.

---

## Task 4: Add Safe Command Audit Metadata

**Files:**
- Modify: `agent/extensions/harness/src/audit/types.ts`
- Create: `agent/extensions/harness/src/audit/target.ts`
- Test: `agent/extensions/harness/tests/audit/target.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, expect, it } from "vitest";
import { commandAuditTarget } from "../../src/audit/target";

describe("commandAuditTarget", () => {
  it("stores command family and hash instead of full command", () => {
    const target = commandAuditTarget("curl https://example.com?token=secret");
    expect(target.kind).toBe("command");
    expect(target.value).toContain("network:");
    expect(target.value).not.toContain("secret");
  });
});
```

**Step 2: Implement**

Use `crypto.createHash("sha256")` and `classifyCommand(command)`. Store `${family}:${executable}:${hash}`.

**Step 3: Wire into before-tool audit logging**

For `bash`, write command audit target. For non-bash, keep existing path/pattern target logic.

**Step 4: Run tests**

```bash
npm test -- tests/audit/target.test.ts tests/hooks/before-tool.test.ts
```

Expected: PASS.

---

## Task 5: Add README Command Governance Section

**Files:**
- Modify: `agent/extensions/harness/README.md`

**Step 1: Add question-led section**

```markdown
### How do I control network and destructive commands?

Harness classifies `bash` by command family before applying policy. This lets teams treat `curl`, package installs, remote execution, and destructive filesystem commands differently.

```json
{
  "id": "team-ask-network",
  "capability": "exec",
  "commandFamily": "network",
  "decision": "ask",
  "reason": "Network commands can exfiltrate data or fetch untrusted code"
}
```
```

**Step 2: Verify Markdown**

```bash
sed -n '1,260p' README.md
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
- Command families are classified.
- Policy can match command family.
- Destructive and network commands are governed by built-in presets.
- Full commands are not stored raw in audit logs.
