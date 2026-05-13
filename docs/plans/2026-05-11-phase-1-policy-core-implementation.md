# Phase 1 Policy Core Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the durable policy foundation for Harness: JSON policy schema, presets, rule IDs, sensitive-read denial, visible policy denials, audit logging, and fail-closed headless behavior.

**Architecture:** Keep the existing permission manager, but insert a policy layer before the low-risk read bypass in `makeBeforeToolHandler`. Policy is loaded once by the extension entry point, converted into rule objects with stable IDs, then evaluated for every tool call. Policy denials and approvals are recorded as safe audit events.

**Tech Stack:** TypeScript, Node built-ins, `vitest`, existing Harness extension hooks, JSON policy files.

---

## Mental Model

Policy is the durable authority. Session approvals are temporary exceptions. A read is only low-risk after policy has ruled out sensitive paths.

---

## Task 1: Define Policy Types

**Files:**
- Create: `agent/extensions/harness/src/policy/types.ts`
- Test: `agent/extensions/harness/tests/policy/types.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import type { HarnessPolicy } from "../../src/policy/types";

describe("HarnessPolicy", () => {
  it("supports durable rule IDs and presets", () => {
    const policy: HarnessPolicy = {
      version: 1,
      preset: "team",
      rules: [
        {
          id: "deny-env-read",
          capability: "read",
          pattern: ".env*",
          decision: "deny",
          reason: "Environment files may contain secrets",
        },
      ],
      audit: { enabled: true },
      headless: { defaultDecision: "deny" },
    };

    expect(policy.rules[0].id).toBe("deny-env-read");
  });
});
```

**Step 2: Run test to verify failure**

```bash
cd agent/extensions/harness
npm test -- tests/policy/types.test.ts
```

Expected: FAIL because `src/policy/types.ts` does not exist.

**Step 3: Implement policy types**

```typescript
import type { Capability, Decision } from "../permissions/rules";

export type PolicyPreset = "personal" | "team" | "ci";

export interface PolicyRule {
  id: string;
  capability: Capability | "*";
  pattern?: string;
  decision: Decision;
  reason: string;
}

export interface HarnessPolicy {
  version: 1;
  preset: PolicyPreset;
  rules: PolicyRule[];
  audit: { enabled: boolean; path?: string };
  headless: { defaultDecision: Extract<Decision, "allow" | "deny"> };
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/policy/types.test.ts
```

Expected: PASS.

---

## Task 2: Add Policy Schema Validation

**Files:**
- Create: `agent/extensions/harness/src/policy/schema.ts`
- Test: `agent/extensions/harness/tests/policy/schema.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { parsePolicy } from "../../src/policy/schema";

describe("parsePolicy", () => {
  it("accepts a valid policy", () => {
    const parsed = parsePolicy({
      version: 1,
      preset: "team",
      rules: [],
      audit: { enabled: true },
      headless: { defaultDecision: "deny" },
    });

    expect(parsed.preset).toBe("team");
  });

  it("rejects rules without stable IDs", () => {
    expect(() =>
      parsePolicy({
        version: 1,
        preset: "team",
        rules: [{ capability: "read", decision: "deny", reason: "missing id" }],
        audit: { enabled: true },
        headless: { defaultDecision: "deny" },
      }),
    ).toThrow(/id/i);
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/policy/schema.test.ts
```

Expected: FAIL because `parsePolicy` does not exist.

**Step 3: Implement minimal runtime validation**

```typescript
import type { HarnessPolicy, PolicyPreset } from "./types";

const PRESETS = new Set<PolicyPreset>(["personal", "team", "ci"]);
const DECISIONS = new Set(["allow", "deny", "ask"]);
const CAPABILITIES = new Set(["read", "edit", "exec", "task", "*"]);

export function parsePolicy(value: unknown): HarnessPolicy {
  const policy = value as HarnessPolicy;
  if (!policy || typeof policy !== "object") throw new Error("Policy must be an object");
  if (policy.version !== 1) throw new Error("Policy version must be 1");
  if (!PRESETS.has(policy.preset)) throw new Error("Policy preset is invalid");
  if (!Array.isArray(policy.rules)) throw new Error("Policy rules must be an array");

  for (const rule of policy.rules) {
    if (!rule.id || typeof rule.id !== "string") throw new Error("Policy rule id is required");
    if (!CAPABILITIES.has(rule.capability)) throw new Error(`Invalid capability for ${rule.id}`);
    if (!DECISIONS.has(rule.decision)) throw new Error(`Invalid decision for ${rule.id}`);
    if (!rule.reason || typeof rule.reason !== "string") throw new Error(`Policy rule ${rule.id} needs a reason`);
  }

  return policy;
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/policy/schema.test.ts
```

Expected: PASS.

---

## Task 3: Add Built-in Policy Presets

**Files:**
- Create: `agent/extensions/harness/src/policy/presets.ts`
- Test: `agent/extensions/harness/tests/policy/presets.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { getPresetPolicy } from "../../src/policy/presets";

describe("getPresetPolicy", () => {
  it("team preset denies known sensitive reads", () => {
    const policy = getPresetPolicy("team");
    expect(policy.rules.some((rule) => rule.id === "builtin-deny-env-read")).toBe(true);
    expect(policy.headless.defaultDecision).toBe("deny");
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/policy/presets.test.ts
```

Expected: FAIL because presets do not exist.

**Step 3: Implement presets**

```typescript
import type { HarnessPolicy, PolicyPreset } from "./types";

const sensitiveReadRules = [
  { id: "builtin-deny-env-read", capability: "read", pattern: ".env*", decision: "deny", reason: "Environment files may contain secrets" },
  { id: "builtin-deny-private-key-read", capability: "read", pattern: "**/*.{pem,key}", decision: "deny", reason: "Private key material must not be read by agents" },
  { id: "builtin-deny-ssh-key-read", capability: "read", pattern: "**/id_rsa*", decision: "deny", reason: "SSH private keys must not be read by agents" },
] as const;

export function getPresetPolicy(preset: PolicyPreset): HarnessPolicy {
  return {
    version: 1,
    preset,
    rules: preset === "personal" ? [...sensitiveReadRules] : [...sensitiveReadRules],
    audit: { enabled: preset !== "personal" },
    headless: { defaultDecision: preset === "personal" ? "deny" : "deny" },
  };
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/policy/presets.test.ts
```

Expected: PASS.

---

## Task 4: Load Project Policy JSON

**Files:**
- Create: `agent/extensions/harness/src/policy/loader.ts`
- Test: `agent/extensions/harness/tests/policy/loader.test.ts`
- Example: `agent/extensions/harness/harness.policy.json`

**Step 1: Write the failing test**

```typescript
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadPolicy } from "../../src/policy/loader";

describe("loadPolicy", () => {
  it("loads harness.policy.json when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "harness-policy-"));
    await writeFile(
      join(dir, "harness.policy.json"),
      JSON.stringify({
        version: 1,
        preset: "team",
        rules: [{ id: "project-deny-token", capability: "read", pattern: "**/token.json", decision: "deny", reason: "Token cache" }],
        audit: { enabled: true },
        headless: { defaultDecision: "deny" },
      }),
    );

    const policy = await loadPolicy(dir);
    expect(policy.rules[0].id).toBe("project-deny-token");
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/policy/loader.test.ts
```

Expected: FAIL because loader does not exist.

**Step 3: Implement loader**

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parsePolicy } from "./schema";
import { getPresetPolicy } from "./presets";

export async function loadPolicy(cwd = process.cwd()) {
  try {
    const raw = await readFile(join(cwd, "harness.policy.json"), "utf-8");
    return parsePolicy(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return getPresetPolicy("team");
    throw error;
  }
}
```

**Step 4: Add example policy**

```json
{
  "version": 1,
  "preset": "team",
  "rules": [],
  "audit": { "enabled": true },
  "headless": { "defaultDecision": "deny" }
}
```

**Step 5: Run tests**

```bash
npm test -- tests/policy/loader.test.ts tests/policy/presets.test.ts tests/policy/schema.test.ts
```

Expected: PASS.

---

## Task 5: Evaluate Policy Before Low-risk Read Bypass

**Files:**
- Create: `agent/extensions/harness/src/policy/evaluator.ts`
- Modify: `agent/extensions/harness/src/hooks/before-tool.ts`
- Test: `agent/extensions/harness/tests/hooks/before-tool.test.ts`
- Test: `agent/extensions/harness/tests/policy/evaluator.test.ts`

**Step 1: Write failing policy evaluator test**

```typescript
import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../../src/policy/evaluator";

describe("evaluatePolicy", () => {
  it("denies a sensitive read before generic read allow", () => {
    const result = evaluatePolicy(
      {
        version: 1,
        preset: "team",
        audit: { enabled: true },
        headless: { defaultDecision: "deny" },
        rules: [{ id: "deny-env", capability: "read", pattern: ".env*", decision: "deny", reason: "secret" }],
      },
      "read",
      ".env.local",
    );

    expect(result?.decision).toBe("deny");
    expect(result?.ruleId).toBe("deny-env");
  });
});
```

**Step 2: Implement policy evaluation**

```typescript
import type { Capability, Decision } from "../permissions/rules";
import type { HarnessPolicy } from "./types";

export interface PolicyDecision {
  decision: Decision;
  ruleId: string;
  reason: string;
  pattern?: string;
}

function matches(pattern: string | undefined, target: string): boolean {
  if (!pattern || pattern === "*") return true;
  const regex = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
  return regex.test(target);
}

export function evaluatePolicy(policy: HarnessPolicy, capability: Capability, target: string): PolicyDecision | null {
  let match: PolicyDecision | null = null;
  for (const rule of policy.rules) {
    const capMatch = rule.capability === "*" || rule.capability === capability;
    if (capMatch && matches(rule.pattern, target)) {
      match = { decision: rule.decision, ruleId: rule.id, reason: rule.reason, pattern: rule.pattern };
    }
  }
  return match;
}
```

**Step 3: Modify `makeBeforeToolHandler`**

Add a `policy` argument and evaluate it before the low-risk return. A deny returns a visible policy denial. An allow lets the call continue. An ask falls through to the normal prompt path.

**Step 4: Run focused tests**

```bash
npm test -- tests/policy/evaluator.test.ts tests/hooks/before-tool.test.ts
```

Expected: PASS.

---

## Task 6: Add Visible Policy Denial Shape

**Files:**
- Create: `agent/extensions/harness/src/policy/denial.ts`
- Modify: `agent/extensions/harness/src/hooks/before-tool.ts`
- Test: `agent/extensions/harness/tests/policy/denial.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, expect, it } from "vitest";
import { formatPolicyDenial } from "../../src/policy/denial";

describe("formatPolicyDenial", () => {
  it("shows safe metadata without file contents", () => {
    expect(formatPolicyDenial({ ruleId: "deny-env", pattern: ".env*", reason: "secret" })).toBe(
      'Blocked by policy deny-env: secret (matched ".env*")',
    );
  });
});
```

**Step 2: Implement**

```typescript
export function formatPolicyDenial(input: { ruleId: string; reason: string; pattern?: string }): string {
  const matched = input.pattern ? ` (matched "${input.pattern}")` : "";
  return `Blocked by policy ${input.ruleId}: ${input.reason}${matched}`;
}
```

**Step 3: Wire into before-tool**

When `evaluatePolicy` returns `deny`, block with `formatPolicyDenial(decision)`.

**Step 4: Run tests**

```bash
npm test -- tests/policy/denial.test.ts tests/hooks/before-tool.test.ts
```

Expected: PASS.

---

## Task 7: Add Audit Log Events

**Files:**
- Create: `agent/extensions/harness/src/audit/types.ts`
- Create: `agent/extensions/harness/src/audit/logger.ts`
- Test: `agent/extensions/harness/tests/audit/logger.test.ts`
- Modify: `agent/extensions/harness/src/hooks/before-tool.ts`

**Step 1: Write failing test**

```typescript
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AuditLogger } from "../../src/audit/logger";

describe("AuditLogger", () => {
  it("writes JSONL events with safe target metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "harness-audit-"));
    const logger = new AuditLogger(join(dir, "audit.jsonl"));
    await logger.record({
      timestamp: "2026-05-11T00:00:00.000Z",
      sessionId: "test",
      agentType: "parent",
      toolName: "read",
      capability: "read",
      decision: "deny",
      ruleId: "deny-env",
      target: { kind: "pattern", value: ".env*" },
    });

    const raw = await readFile(join(dir, "audit.jsonl"), "utf-8");
    expect(JSON.parse(raw).ruleId).toBe("deny-env");
  });
});
```

**Step 2: Implement audit types and logger**

```typescript
// src/audit/types.ts
import type { Capability, Decision } from "../permissions/rules";

export interface AuditEvent {
  timestamp: string;
  sessionId: string;
  agentType: "parent" | "subagent";
  toolName: string;
  capability: Capability;
  decision: Decision;
  ruleId?: string;
  target: { kind: "literal" | "pattern" | "hash"; value: string };
}
```

```typescript
// src/audit/logger.ts
import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditEvent } from "./types";

export class AuditLogger {
  constructor(private readonly path: string) {}

  async record(event: AuditEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf-8");
  }
}
```

**Step 3: Wire logger into before-tool**

Record every final allow, deny, and ask decision. For sensitive policy matches, use `{ kind: "pattern", value: matchedPattern }`.

**Step 4: Run tests**

```bash
npm test -- tests/audit/logger.test.ts tests/hooks/before-tool.test.ts
```

Expected: PASS.

---

## Task 8: Wire Policy Into Extension Entry Point

**Files:**
- Modify: `agent/extensions/harness/src/index.ts`
- Test: existing hook tests

**Step 1: Load policy in `register`**

Use `loadPolicy(process.cwd())` before constructing the before-tool handler. Because Pi event handlers are async, store the promise and await it inside the `tool_call` handler.

**Step 2: Construct audit logger**

Default path: `.harness/audit.jsonl` under the current working directory unless the policy specifies another path.

**Step 3: Pass policy and audit logger into `makeBeforeToolHandler`**

Keep tests dependency-injected. Do not make hook code read the filesystem directly.

**Step 4: Run all tests**

```bash
npm test
```

Expected: all tests pass.

---

## Task 9: Update README With First Policy-first Example

**Files:**
- Modify: `agent/extensions/harness/README.md`

**Step 1: Add a question-led section**

Add:

```markdown
### How do I stop agents from reading secrets?

Some reads are not low-risk. Harness checks sensitive-read policy before allowing `read`, `ls`, `find`, or `grep`.

```json
{
  "version": 1,
  "preset": "team",
  "rules": [
    {
      "id": "team-deny-env-read",
      "capability": "read",
      "pattern": ".env*",
      "decision": "deny",
      "reason": "Environment files may contain secrets"
    }
  ],
  "audit": { "enabled": true },
  "headless": { "defaultDecision": "deny" }
}
```

When blocked, Harness reports the matched policy rule without showing file contents.
```

**Step 2: Verify docs render as plain Markdown**

```bash
sed -n '1,220p' README.md
```

Expected: the new section is readable and code fences are balanced.

---

## Final Verification

Run:

```bash
cd agent/extensions/harness
npm test
node ./node_modules/typescript/bin/tsc --noEmit
```

Expected:
- Vitest passes.
- TypeScript passes.
- A default `team` policy denies sensitive reads before low-risk bypass.
- Headless mode denies anything that would require `ask` unless explicitly allowed.
- Policy denials include safe rule metadata.
- Audit log records policy decisions without secret contents.
