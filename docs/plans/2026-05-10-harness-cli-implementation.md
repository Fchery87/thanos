# Harness CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Pi extension that adds capability-based permissions, an ambient spec system with optional explicit-tier approval, and Ask/Plan/Build subagent delegation to the Pi coding agent CLI.

**Architecture:** A Pi extension at `~/.pi/agent/extensions/harness/`. Hooks `tool_call` (permission gate + explicit-spec approval gate) and `tool_result` (output collection). Uses `before_agent_start` to classify each user message + reset state, and `agent_end` to display spec verification. Registers a `task` tool that spawns isolated specialist subagents via `pi --mode json -p --no-session --append-system-prompt <file> [--tools <list>]`. Agent prompts live inside the extension repo, not in Pi's user agent directory.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` (extension types + `parseFrontmatter` / `stripFrontmatter` helpers), `typebox` (Pi-bundled), `vitest`, Node built-ins.

---

## Pre-flight Checks

```bash
# Confirm Pi version
~/.nvm/versions/node/v24.15.0/bin/pi --version

# Confirm extension directory
ls ~/.pi/agent/extensions/ 2>/dev/null || mkdir -p ~/.pi/agent/extensions/
```

---

## Task 1: Scaffold the Extension

**Files:**
- Create: `~/.pi/agent/extensions/harness/package.json`
- Create: `~/.pi/agent/extensions/harness/tsconfig.json`
- Create: `~/.pi/agent/extensions/harness/vitest.config.ts`
- Create: `~/.pi/agent/extensions/harness/src/index.ts`

**Step 1: Create directory structure**

```bash
mkdir -p ~/.pi/agent/extensions/harness/src/{permissions,spec,agents,hooks}
mkdir -p ~/.pi/agent/extensions/harness/tests/{permissions,spec,agents,hooks}
mkdir -p ~/.pi/agent/extensions/harness/agents
```

**Step 2: Create package.json**

```json
{
  "name": "harness",
  "version": "0.1.0",
  "type": "module",
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "^0.74.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

> `typebox` is Pi-bundled and resolved at runtime from Pi's `node_modules`.

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "baseUrl": "."
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { globals: true, environment: "node" },
});
```

**Step 5: Create placeholder entry point**

```typescript
// src/index.ts
export default function register(_pi: unknown) {
  // wired in Task 13
}
```

**Step 6: Install devDependencies**

```bash
cd ~/.pi/agent/extensions/harness && npm install
```

**Step 7: Initialize git and commit**

```bash
cd ~/.pi/agent/extensions/harness
git init && git add -A
git commit -m "feat: scaffold harness extension"
```

---

## Task 2: Risk Classifier

**Files:**
- Create: `src/permissions/risk.ts`
- Create: `tests/permissions/risk.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/permissions/risk.test.ts
import { describe, it, expect } from "vitest";
import { classifyRisk } from "../../src/permissions/risk";

describe("classifyRisk", () => {
  it("classifies read as low", () => expect(classifyRisk("read", {})).toBe("low"));
  it("classifies ls as low",   () => expect(classifyRisk("ls",   {})).toBe("low"));
  it("classifies find as low", () => expect(classifyRisk("find", {})).toBe("low"));
  it("classifies grep as low", () => expect(classifyRisk("grep", {})).toBe("low"));
  it("classifies write as high",    () => expect(classifyRisk("write", {})).toBe("high"));
  it("classifies edit as high",     () => expect(classifyRisk("edit",  {})).toBe("high"));
  it("classifies bash as critical", () => expect(classifyRisk("bash",  {})).toBe("critical"));
  it("classifies task as medium",   () => expect(classifyRisk("task",  {})).toBe("medium"));
  it("defaults unknown to medium",  () => expect(classifyRisk("unknown", {})).toBe("medium"));
});
```

**Step 2: Run test to verify failure**

```bash
cd ~/.pi/agent/extensions/harness && npm test -- tests/permissions/risk.test.ts
```

**Step 3: Implement**

```typescript
// src/permissions/risk.ts
export type RiskTier = "low" | "medium" | "high" | "critical";

const RISK_MAP: Record<string, RiskTier> = {
  read:  "low",
  ls:    "low",
  find:  "low",
  grep:  "low",
  write: "high",
  edit:  "high",
  bash:  "critical",
  task:  "medium",
};

export function classifyRisk(toolName: string, _args: Record<string, unknown>): RiskTier {
  return RISK_MAP[toolName] ?? "medium";
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/permissions/risk.test.ts
```

**Step 5: Commit**

```bash
git add src/permissions/risk.ts tests/permissions/risk.test.ts
git commit -m "feat: add risk tier classifier"
```

---

## Task 3: Permission Rule Evaluation

**Files:**
- Create: `src/permissions/rules.ts`
- Create: `tests/permissions/rules.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/permissions/rules.test.ts
import { describe, it, expect } from "vitest";
import { evaluateRules, type PermissionRule } from "../../src/permissions/rules";

const rules: PermissionRule[] = [
  { capability: "read", decision: "allow", source: "default" },
  { capability: "edit", decision: "ask",   source: "default" },
  { capability: "exec", decision: "ask",   source: "default" },
  { capability: "edit", pattern: "src/**", decision: "allow", source: "session" },
];

describe("evaluateRules", () => {
  it("allows read by default", () => {
    expect(evaluateRules(rules, "read", "any/file.ts")).toBe("allow");
  });

  it("asks for edit by default", () => {
    expect(evaluateRules(rules, "edit", "lib/foo.ts")).toBe("ask");
  });

  it("allows edit under src/ via session override", () => {
    expect(evaluateRules(rules, "edit", "src/bar.ts")).toBe("allow");
  });

  it("denies via wildcard capability", () => {
    const denyAll: PermissionRule[] = [
      ...rules,
      { capability: "*", decision: "deny", source: "session" },
    ];
    expect(evaluateRules(denyAll, "edit", "src/bar.ts")).toBe("deny");
    expect(evaluateRules(denyAll, "exec", "ls")).toBe("deny");
  });

  it("returns ask when no rules match", () => {
    expect(evaluateRules([], "edit", "foo.ts")).toBe("ask");
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/permissions/rules.test.ts
```

**Step 3: Implement**

```typescript
// src/permissions/rules.ts
export type Capability = "read" | "edit" | "exec" | "task";
export type Decision = "allow" | "deny" | "ask";
export type RuleSource = "default" | "user" | "session" | "spec";

export interface PermissionRule {
  capability: Capability | "*";
  pattern?: string;
  decision: Decision;
  source: RuleSource;
}

function matchesPattern(pattern: string | undefined, target: string): boolean {
  if (!pattern || pattern === "*") return true;
  const regex = new RegExp(
    "^" + pattern.replace(/\*\*/g, "(.+)").replace(/\*/g, "([^/]+)") + "$"
  );
  return regex.test(target);
}

export function evaluateRules(
  rules: PermissionRule[],
  capability: Capability,
  target: string
): Decision {
  let decision: Decision = "ask";
  for (const rule of rules) {
    const capMatch = rule.capability === "*" || rule.capability === capability;
    if (capMatch && matchesPattern(rule.pattern, target)) {
      decision = rule.decision;
    }
  }
  return decision;
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/permissions/rules.test.ts
```

**Step 5: Commit**

```bash
git add src/permissions/rules.ts tests/permissions/rules.test.ts
git commit -m "feat: add capability-based rule evaluation (last-rule-wins)"
```

---

## Task 4: PermissionManager

`narrow()` is omitted — subagents run in a subprocess and load their own PermissionManager from defaults; capability narrowing happens via the `--tools` CLI flag in Task 10.

**Files:**
- Create: `src/permissions/manager.ts`
- Create: `tests/permissions/manager.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/permissions/manager.test.ts
import { describe, it, expect } from "vitest";
import { PermissionManager } from "../../src/permissions/manager";

describe("PermissionManager", () => {
  it("allows read by default", () => {
    expect(new PermissionManager().evaluate("read", "any/file.ts")).toBe("allow");
  });

  it("asks for exec by default", () => {
    expect(new PermissionManager().evaluate("exec", "rm -rf")).toBe("ask");
  });

  it("caches a session decision", () => {
    const pm = new PermissionManager();
    pm.remember("edit", "src/**", "allow");
    expect(pm.evaluate("edit", "src/foo.ts")).toBe("allow");
    expect(pm.evaluate("edit", "lib/bar.ts")).toBe("ask");
  });

  it("supports wildcard-capability rules for blanket denial", () => {
    const pm = new PermissionManager();
    pm.remember("*", "*", "deny");
    expect(pm.evaluate("edit", "src/foo.ts")).toBe("deny");
    expect(pm.evaluate("exec", "ls")).toBe("deny");
    // read still goes through bypass at the hook layer, but rule-wise it's denied too
    expect(pm.evaluate("read", "any.ts")).toBe("deny");
  });

  it("clears session-scoped rules", () => {
    const pm = new PermissionManager();
    pm.remember("*", "*", "deny");
    pm.clearSessionRules();
    expect(pm.evaluate("edit", "src/foo.ts")).toBe("ask");
    expect(pm.evaluate("read", "x.ts")).toBe("allow");  // defaults restored
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/permissions/manager.test.ts
```

**Step 3: Implement**

```typescript
// src/permissions/manager.ts
import {
  evaluateRules,
  type Capability,
  type Decision,
  type PermissionRule,
} from "./rules";

const DEFAULT_RULES: PermissionRule[] = [
  { capability: "read", decision: "allow", source: "default" },
  { capability: "edit", decision: "ask",   source: "default" },
  { capability: "exec", decision: "ask",   source: "default" },
  { capability: "task", decision: "ask",   source: "default" },
];

export class PermissionManager {
  private rules: PermissionRule[];

  constructor(rules: PermissionRule[] = [...DEFAULT_RULES]) {
    this.rules = rules;
  }

  evaluate(capability: Capability, target: string): Decision {
    return evaluateRules(this.rules, capability, target);
  }

  remember(capability: Capability | "*", pattern: string, decision: Decision): void {
    this.rules.push({ capability, pattern, decision, source: "session" });
  }

  clearSessionRules(): void {
    this.rules = this.rules.filter((r) => r.source !== "session");
  }
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/permissions/manager.test.ts
```

**Step 5: Commit**

```bash
git add src/permissions/manager.ts tests/permissions/manager.test.ts
git commit -m "feat: add PermissionManager with session memory + wildcard support"
```

---

## Task 5: Spec Types & Classifier

**Files:**
- Create: `src/spec/types.ts`
- Create: `src/spec/classifier.ts`
- Create: `tests/spec/classifier.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/spec/classifier.test.ts
import { describe, it, expect } from "vitest";
import { classifySpec } from "../../src/spec/classifier";

describe("classifySpec", () => {
  it("classifies a question as instant", () => {
    expect(classifySpec("What does this function do?")).toBe("instant");
  });

  it("classifies a trivial request as instant", () => {
    expect(classifySpec("Run the tests")).toBe("instant");
  });

  it("classifies a multi-file refactor as ambient", () => {
    expect(classifySpec("Refactor the auth module to use JWT")).toBe("ambient");
  });

  it("does NOT upgrade instant to explicit even with --spec flag", () => {
    expect(classifySpec("What does this function do?", true)).toBe("instant");
  });

  it("upgrades ambient to explicit with --spec flag", () => {
    expect(classifySpec("Refactor the auth module", true)).toBe("explicit");
  });

  it("classifies a new system build as ambient without --spec flag", () => {
    expect(classifySpec("Build a REST API for user auth")).toBe("ambient");
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/spec/classifier.test.ts
```

**Step 3: Implement**

```typescript
// src/spec/types.ts
export type SpecTier = "instant" | "ambient" | "explicit";
export type SpecStatus = "active" | "verified" | "failed";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected";

export interface AcceptanceCriterion {
  description: string;
  keywords: string[];
}

export interface FormalSpec {
  id: string;
  tier: SpecTier;
  status: SpecStatus;
  approvalStatus: ApprovalStatus;
  goal: string;
  constraints: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  targetFiles: string[];
  risks: string[];
  createdAt: number;
}
```

```typescript
// src/spec/classifier.ts
import type { SpecTier } from "./types";

const INSTANT_PATTERNS = [
  /^(what|how|why|explain|show|describe|list|tell me)/i,
  /\?$/,
  /^run (the )?tests?$/i,
  /^(fix the typo|fix a typo)/i,
];

const AMBIENT_SIGNALS = [
  /\b(refactor|restructure|reorganize)\b/i,
  /\b(build|create|implement|write)\b.*(api|server|service|system|app|cli)/i,
  /\b(migrate|migration)\b/i,
  /\b(update|upgrade|add|remove)\b.*(module|package|dependency)/i,
  /\b(add|implement)\b.*(feature|endpoint|route|handler)/i,
];

export function classifySpec(message: string, specFlag = false): SpecTier {
  // instant always wins — never upgraded by --spec flag
  if (INSTANT_PATTERNS.some((p) => p.test(message))) return "instant";

  const isAmbient = AMBIENT_SIGNALS.some((p) => p.test(message));
  if (isAmbient) return specFlag ? "explicit" : "ambient";

  return "instant";
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/spec/classifier.test.ts
```

**Step 5: Commit**

```bash
git add src/spec/types.ts src/spec/classifier.ts tests/spec/classifier.test.ts
git commit -m "feat: add spec types and classifier (instant always wins)"
```

---

## Task 6: Spec Generator

**Files:**
- Create: `src/spec/generator.ts`
- Create: `tests/spec/generator.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/spec/generator.test.ts
import { describe, it, expect } from "vitest";
import { generateSpec } from "../../src/spec/generator";

describe("generateSpec", () => {
  it("generates a spec with id, goal, and tier", () => {
    const spec = generateSpec("Add pagination to the users endpoint", "ambient");
    expect(spec.id).toMatch(/^spec-/);
    expect(spec.goal).toBe("Add pagination to the users endpoint");
    expect(spec.tier).toBe("ambient");
    expect(spec.status).toBe("active");
  });

  it("sets approvalStatus to pending for explicit tier", () => {
    const spec = generateSpec("anything", "explicit");
    expect(spec.approvalStatus).toBe("pending");
  });

  it("sets approvalStatus to not_required for ambient tier", () => {
    const spec = generateSpec("anything", "ambient");
    expect(spec.approvalStatus).toBe("not_required");
  });

  it("generates at least one acceptance criterion", () => {
    const spec = generateSpec("Add pagination to the users endpoint", "ambient");
    expect(spec.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it("sets createdAt to a recent timestamp", () => {
    const before = Date.now();
    const spec = generateSpec("anything", "ambient");
    expect(spec.createdAt).toBeGreaterThanOrEqual(before);
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/spec/generator.test.ts
```

**Step 3: Implement**

```typescript
// src/spec/generator.ts
import type {
  FormalSpec,
  SpecTier,
  AcceptanceCriterion,
  ApprovalStatus,
} from "./types";

let counter = 0;
const newId = () => `spec-${Date.now()}-${++counter}`;

function buildCriteria(message: string): AcceptanceCriterion[] {
  const lower = message.toLowerCase();
  const criteria: AcceptanceCriterion[] = [];

  if (/\badd\b/.test(lower))
    criteria.push({ description: "Feature added as described", keywords: ["added", "created", "implemented"] });
  if (/\btest/.test(lower))
    criteria.push({ description: "Tests written", keywords: ["test", "spec", "passing"] });
  if (/\brefactor/.test(lower))
    criteria.push({ description: "Code refactored", keywords: ["refactored", "updated", "simplified"] });
  if (criteria.length === 0)
    criteria.push({ description: "Task completed", keywords: ["done", "complete", "created", "updated", "finished"] });

  return criteria;
}

function approvalFor(tier: SpecTier): ApprovalStatus {
  return tier === "explicit" ? "pending" : "not_required";
}

export function generateSpec(message: string, tier: SpecTier): FormalSpec {
  return {
    id: newId(),
    tier,
    status: "active",
    approvalStatus: approvalFor(tier),
    goal: message,
    constraints: [],
    acceptanceCriteria: buildCriteria(message),
    targetFiles: [],
    risks: [],
    createdAt: Date.now(),
  };
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/spec/generator.test.ts
```

**Step 5: Commit**

```bash
git add src/spec/generator.ts tests/spec/generator.test.ts
git commit -m "feat: add heuristic spec generator with approval status"
```

---

## Task 7: Spec Verifier

**Files:**
- Create: `src/spec/verifier.ts`
- Create: `tests/spec/verifier.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/spec/verifier.test.ts
import { describe, it, expect } from "vitest";
import { verifySpec } from "../../src/spec/verifier";
import type { FormalSpec } from "../../src/spec/types";

const spec: FormalSpec = {
  id: "spec-1",
  tier: "ambient",
  status: "active",
  approvalStatus: "not_required",
  goal: "Add pagination",
  constraints: [], risks: [], targetFiles: [],
  createdAt: Date.now(),
  acceptanceCriteria: [
    { description: "Pagination added", keywords: ["pagination", "offset", "limit"] },
    { description: "Tests written",    keywords: ["test", "spec"] },
  ],
};

describe("verifySpec", () => {
  it("passes criterion when keyword appears in tool outputs", () => {
    const results = verifySpec(spec, ["added pagination with offset and limit"]);
    expect(results[0].passed).toBe(true);
  });

  it("fails criterion when keywords are absent", () => {
    const results = verifySpec(spec, ["added pagination with offset and limit"]);
    expect(results[1].passed).toBe(false);
  });

  it("passes when any keyword matches", () => {
    const results = verifySpec(spec, ["spec written for pagination"]);
    expect(results[1].passed).toBe(true);
  });

  it("returns one result per criterion", () => {
    expect(verifySpec(spec, [])).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/spec/verifier.test.ts
```

**Step 3: Implement**

```typescript
// src/spec/verifier.ts
import type { FormalSpec, AcceptanceCriterion } from "./types";

export interface VerificationResult {
  criterion: AcceptanceCriterion;
  passed: boolean;
}

export function verifySpec(spec: FormalSpec, toolOutputs: string[]): VerificationResult[] {
  const combined = toolOutputs.join(" ").toLowerCase();
  return spec.acceptanceCriteria.map((criterion) => ({
    criterion,
    passed: criterion.keywords.some((kw) => combined.includes(kw.toLowerCase())),
  }));
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/spec/verifier.test.ts
```

**Step 5: Commit**

```bash
git add src/spec/verifier.ts tests/spec/verifier.test.ts
git commit -m "feat: add spec verifier with keyword matching"
```

---

## Task 8: SpecEngine

**Files:**
- Create: `src/spec/engine.ts`
- Create: `tests/spec/engine.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/spec/engine.test.ts
import { describe, it, expect } from "vitest";
import { SpecEngine } from "../../src/spec/engine";

describe("SpecEngine", () => {
  it("produces no spec for instant messages", () => {
    const e = new SpecEngine();
    expect(e.classify("What does this do?")).toBe("instant");
    expect(e.activeSpec).toBeNull();
  });

  it("activates a spec for ambient messages", () => {
    const e = new SpecEngine();
    e.classify("Refactor the auth module");
    expect(e.activeSpec?.tier).toBe("ambient");
    expect(e.activeSpec?.approvalStatus).toBe("not_required");
  });

  it("activates a pending spec when --spec flag is on", () => {
    const e = new SpecEngine();
    e.classify("Refactor the auth module", true);
    expect(e.activeSpec?.tier).toBe("explicit");
    expect(e.activeSpec?.approvalStatus).toBe("pending");
  });

  it("collects tool output and verifies", () => {
    const e = new SpecEngine();
    e.classify("Add pagination to users endpoint");
    e.recordToolOutput("added pagination with offset and limit params");
    expect(e.verify()[0].passed).toBe(true);
  });

  it("returns empty verify results when no active spec", () => {
    const e = new SpecEngine();
    e.classify("What is 2+2?");
    expect(e.verify()).toHaveLength(0);
  });

  it("resets cleanly", () => {
    const e = new SpecEngine();
    e.classify("Refactor the auth module");
    e.reset();
    expect(e.activeSpec).toBeNull();
    expect(e.verify()).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/spec/engine.test.ts
```

**Step 3: Implement**

```typescript
// src/spec/engine.ts
import { classifySpec } from "./classifier";
import { generateSpec } from "./generator";
import { verifySpec, type VerificationResult } from "./verifier";
import type { FormalSpec, SpecTier } from "./types";

export class SpecEngine {
  activeSpec: FormalSpec | null = null;
  private toolOutputs: string[] = [];

  classify(message: string, specFlag = false): SpecTier {
    const tier = classifySpec(message, specFlag);
    this.activeSpec = tier !== "instant" ? generateSpec(message, tier) : null;
    return tier;
  }

  recordToolOutput(output: string): void {
    this.toolOutputs.push(output);
  }

  verify(): VerificationResult[] {
    if (!this.activeSpec) return [];
    return verifySpec(this.activeSpec, this.toolOutputs);
  }

  reset(): void {
    this.activeSpec = null;
    this.toolOutputs = [];
  }
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/spec/engine.test.ts
```

**Step 5: Commit**

```bash
git add src/spec/engine.ts tests/spec/engine.test.ts
git commit -m "feat: add SpecEngine orchestrating classify → verify"
```

---

## Task 9: Agent Markdown Files (inside the extension)

Specialist prompts live inside the extension repo so they version-control with the code.

**Files:**
- Create: `~/.pi/agent/extensions/harness/agents/ask.md`
- Create: `~/.pi/agent/extensions/harness/agents/plan.md`
- Create: `~/.pi/agent/extensions/harness/agents/build.md`
- Create: `src/agents/registry.ts`
- Create: `src/agents/loader.ts`
- Create: `tests/agents/loader.test.ts`

**Step 1: Create ask.md**

```markdown
---
name: ask
description: Answers questions and explains existing code. Read-only.
tools: read, ls, find, grep
---

You are a specialist agent focused on understanding and explaining code.

Your job: read files, search the codebase, and give clear, accurate answers to the assigned question.

Rules:
- You may NOT write or modify any files
- You may NOT run shell commands
- Provide your answer as a single, well-organized response

Output format:
## Answer
[Your explanation here]

## References
- `path/to/file.ts:line` — what you found there
```

**Step 2: Create plan.md**

```markdown
---
name: plan
description: Researches the codebase and produces a structured implementation plan. Read-only.
tools: read, ls, find, grep
---

You are a specialist agent focused on technical planning and design.

Your job: research the codebase, understand constraints, and produce a clear implementation plan.

Rules:
- You may NOT write or modify any files
- You may NOT run shell commands

Output format:
## Goal
One sentence summary.

## Plan
Numbered steps, each small and actionable.

## Files to Touch
- `path/to/file.ts` — what changes

## Risks
Anything to watch out for.
```

**Step 3: Create build.md**

No `tools:` frontmatter — build is intentionally unrestricted (all built-in tools). The child subprocess still asks for confirmation via its own PermissionManager.

```markdown
---
name: build
description: Implements features and fixes bugs. Can read, write, and run commands.
---

You are a specialist agent focused on implementation.

Your job: write code, edit files, and run commands to complete the assigned task.

Rules:
- You may NOT spawn further subagents (no task tool — enforced by HARNESS_SUBAGENT=1)
- Be methodical: read before writing, test your changes

Output format when done:
## Completed
What was done.

## Files Changed
- `path/to/file.ts` — what changed

## Notes
Anything the main agent should know.
```

**Step 4: Create agent registry (metadata)**

```typescript
// src/agents/registry.ts
export type AgentType = "ask" | "plan" | "build";

export interface AgentMeta {
  type: AgentType;
  description: string;
}

export const AGENT_META: Record<AgentType, AgentMeta> = {
  ask:   { type: "ask",   description: "Answers questions and explains existing code. Read-only." },
  plan:  { type: "plan",  description: "Researches and produces a structured implementation plan. Read-only." },
  build: { type: "build", description: "Implements features — can read, write, and run commands." },
};

export const AGENT_TYPES: AgentType[] = ["ask", "plan", "build"];
```

**Step 5: Write the failing loader test**

```typescript
// tests/agents/loader.test.ts
import { describe, it, expect } from "vitest";
import { loadAgent } from "../../src/agents/loader";

describe("loadAgent", () => {
  it("loads ask agent with tools allowlist", () => {
    const agent = loadAgent("ask");
    expect(agent.tools).toEqual(["read", "ls", "find", "grep"]);
    expect(agent.body).toContain("specialist agent focused on understanding");
  });

  it("loads plan agent with tools allowlist", () => {
    const agent = loadAgent("plan");
    expect(agent.tools).toEqual(["read", "ls", "find", "grep"]);
  });

  it("loads build agent with no tools restriction", () => {
    const agent = loadAgent("build");
    expect(agent.tools).toBeUndefined();
    expect(agent.body).toContain("specialist agent focused on implementation");
  });
});
```

**Step 6: Implement the loader**

```typescript
// src/agents/loader.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { type AgentType } from "./registry";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.resolve(HERE, "..", "..", "agents");

export interface LoadedAgent {
  tools?: string[];
  model?: string;
  body: string;
}

export function loadAgent(type: AgentType): LoadedAgent {
  const file = path.join(AGENTS_DIR, `${type}.md`);
  const raw = fs.readFileSync(file, "utf-8");
  const meta = parseFrontmatter(raw) as { tools?: string; model?: string };
  const body = stripFrontmatter(raw);

  return {
    tools: meta.tools?.split(",").map((t) => t.trim()).filter(Boolean),
    model: meta.model,
    body,
  };
}
```

**Step 7: Run loader test**

```bash
npm test -- tests/agents/loader.test.ts
```

Expected: PASS (3 tests)

**Step 8: Commit**

```bash
git add src/agents/registry.ts src/agents/loader.ts tests/agents/loader.test.ts agents/
git commit -m "feat: add agent registry, frontmatter loader, and specialist prompts"
```

---

## Task 10: Task Tool

Spawns a specialist `pi` subprocess in JSON mode, streams `message_end` events to `onUpdate` for live progress, and returns the final assistant text on close.

**Files:**
- Create: `src/agents/task-tool.ts`
- Create: `tests/agents/task-tool.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/agents/task-tool.test.ts
import { describe, it, expect } from "vitest";
import { Value } from "typebox/value";
import { TaskParamsSchema, extractFinalText, extractLatestAssistantText } from "../../src/agents/task-tool";

describe("TaskParamsSchema", () => {
  it("accepts valid ask args", () => {
    expect(Value.Check(TaskParamsSchema, { type: "ask", goal: "Explain auth.ts" })).toBe(true);
  });

  it("rejects empty goal (caught by schema constraints)", () => {
    expect(Value.Check(TaskParamsSchema, { type: "ask", goal: "" })).toBe(false);
  });

  it("rejects invalid type", () => {
    expect(Value.Check(TaskParamsSchema, { type: "wizard", goal: "do something" })).toBe(false);
  });

  it("accepts optional context", () => {
    expect(Value.Check(TaskParamsSchema, { type: "plan", goal: "x", context: "foo" })).toBe(true);
  });
});

describe("extractFinalText", () => {
  it("extracts text from agent_end event", () => {
    const jsonl = [
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({
        type: "agent_end",
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          { role: "assistant", content: [{ type: "text", text: "Here is the answer." }] },
        ],
      }),
    ].join("\n");

    expect(extractFinalText(jsonl)).toBe("Here is the answer.");
  });

  it("returns fallback when no agent_end found", () => {
    expect(extractFinalText("not json")).toBe("(no output)");
  });
});

describe("extractLatestAssistantText", () => {
  it("extracts text from a message_end event", () => {
    const line = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "thinking..." }] },
    });
    expect(extractLatestAssistantText(line)).toBe("thinking...");
  });

  it("returns null for non-assistant or non-text events", () => {
    expect(extractLatestAssistantText(JSON.stringify({ type: "turn_start" }))).toBeNull();
    expect(extractLatestAssistantText("garbage")).toBeNull();
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/agents/task-tool.test.ts
```

**Step 3: Implement**

```typescript
// src/agents/task-tool.ts
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Type, type Static } from "typebox";
import { AGENT_TYPES } from "./registry";
import { loadAgent } from "./loader";

export const TaskParamsSchema = Type.Object({
  type: Type.Union(
    AGENT_TYPES.map((t) => Type.Literal(t)),
    { description: "Specialist: ask (explain), plan (design), build (implement)" },
  ),
  goal: Type.String({
    minLength: 1,
    description: "What the subagent should accomplish",
  }),
  context: Type.Optional(
    Type.String({ description: "Optional file contents or snippets to pass down" }),
  ),
});

export type TaskParams = Static<typeof TaskParamsSchema>;

export function extractFinalText(stdout: string): string {
  const lines = stdout.split("\n").reverse();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === "agent_end" && Array.isArray(ev.messages)) {
        for (let i = ev.messages.length - 1; i >= 0; i--) {
          const msg = ev.messages[i];
          if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "text" && part.text) return part.text as string;
            }
          }
        }
      }
    } catch { continue; }
  }
  return "(no output)";
}

export function extractLatestAssistantText(line: string): string | null {
  try {
    const ev = JSON.parse(line);
    if (ev.type !== "message_end" || ev.message?.role !== "assistant") return null;
    for (const part of ev.message.content ?? []) {
      if (part.type === "text" && part.text) return part.text as string;
    }
  } catch { /* not json */ }
  return null;
}

function getPiInvocation(args: string[]): { cmd: string; args: string[] } {
  const script = process.argv[1];
  const isBunVirtual = script?.startsWith("/$bunfs/root/");
  if (script && !isBunVirtual && fs.existsSync(script)) {
    return { cmd: process.execPath, args: [script, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName)) {
    return { cmd: process.execPath, args };
  }
  return { cmd: "pi", args };
}

type OnUpdate = (partial: { content: { type: "text"; text: string }[] }) => void;

export async function executeTask(
  params: TaskParams,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdate | undefined,
): Promise<string> {
  const agent = loadAgent(params.type);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "harness-subagent-"));
  const promptFile = path.join(tmp, `${params.type}.md`);
  await fsp.writeFile(promptFile, agent.body, "utf-8");

  const piArgs: string[] = ["--mode", "json", "-p", "--no-session"];
  if (agent.tools && agent.tools.length > 0) piArgs.push("--tools", agent.tools.join(","));
  if (agent.model) piArgs.push("--model", agent.model);
  piArgs.push("--append-system-prompt", promptFile);

  const taskMessage = params.context
    ? `## Context\n${params.context}\n\n## Task\n${params.goal}`
    : `Task: ${params.goal}`;
  piArgs.push(taskMessage);

  const { cmd, args } = getPiInvocation(piArgs);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, HARNESS_SUBAGENT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    signal?.addEventListener("abort", () => child.kill("SIGTERM"));

    let stdout = "";
    let buffer = "";
    let latestText = "";

    child.stdout.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stdout += chunk;
      buffer += chunk;

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const text = extractLatestAssistantText(line);
        if (text) {
          latestText = text;
          onUpdate?.({ content: [{ type: "text", text: latestText }] });
        }
      }
    });

    child.on("close", async () => {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
      resolve(extractFinalText(stdout));
    });
    child.on("error", reject);
  });
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/agents/task-tool.test.ts
```

Expected: PASS (8 tests)

**Step 5: Commit**

```bash
git add src/agents/task-tool.ts tests/agents/task-tool.test.ts
git commit -m "feat: add task tool with typebox schema, streaming, --append-system-prompt"
```

---

## Task 11: beforeToolCall Hook

Permission gate + explicit-spec approval gate. Low-risk tools bypass; others ask or block.

**Files:**
- Create: `src/hooks/before-tool.ts`
- Create: `tests/hooks/before-tool.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/hooks/before-tool.test.ts
import { describe, it, expect, vi } from "vitest";
import { makeBeforeToolHandler } from "../../src/hooks/before-tool";
import { PermissionManager } from "../../src/permissions/manager";
import { SpecEngine } from "../../src/spec/engine";

const makeEvent = (toolName: string, input: Record<string, unknown> = {}) =>
  ({ toolName, toolCallId: "tc-1", input });

describe("makeBeforeToolHandler", () => {
  it("allows low-risk tools without prompting", async () => {
    const handler = makeBeforeToolHandler(
      new PermissionManager(), new SpecEngine(),
      async () => true, true,
    );
    expect(await handler(makeEvent("read", { file_path: "src/foo.ts" }))).toBeUndefined();
  });

  it("blocks when permission is deny", async () => {
    const pm = new PermissionManager();
    pm.remember("exec", "*", "deny");
    const handler = makeBeforeToolHandler(pm, new SpecEngine(), async () => false, true);
    expect(await handler(makeEvent("bash", { command: "ls" }))).toMatchObject({ block: true });
  });

  it("blocks in non-interactive mode without prompting", async () => {
    const promptUser = vi.fn(async () => true);
    const handler = makeBeforeToolHandler(
      new PermissionManager(), new SpecEngine(),
      promptUser, false,  // hasUI = false
    );
    const result = await handler(makeEvent("bash", { command: "ls" }));
    expect(result).toMatchObject({ block: true });
    expect(promptUser).not.toHaveBeenCalled();
  });

  it("blocks when user declines permission prompt", async () => {
    const handler = makeBeforeToolHandler(
      new PermissionManager(), new SpecEngine(),
      async () => false, true,
    );
    expect(await handler(makeEvent("bash", { command: "ls" }))).toMatchObject({ block: true });
  });

  it("allows when user accepts permission prompt", async () => {
    const handler = makeBeforeToolHandler(
      new PermissionManager(), new SpecEngine(),
      async () => true, true,
    );
    expect(await handler(makeEvent("write", { file_path: "src/foo.ts" }))).toBeUndefined();
  });

  it("requires explicit-spec approval before first non-low-risk tool", async () => {
    const pm = new PermissionManager();
    const spec = new SpecEngine();
    spec.classify("Refactor the auth module", true);  // explicit tier, pending approval
    const approveSpec = vi.fn(async () => true);
    const approveTool = vi.fn(async () => true);
    const handler = makeBeforeToolHandler(pm, spec, approveTool, true, approveSpec);

    const result = await handler(makeEvent("write", { file_path: "src/auth.ts" }));
    expect(approveSpec).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
    expect(spec.activeSpec?.approvalStatus).toBe("approved");
  });

  it("blocks and pushes session-wide deny when explicit-spec rejected", async () => {
    const pm = new PermissionManager();
    const spec = new SpecEngine();
    spec.classify("Refactor the auth module", true);
    const approveSpec = vi.fn(async () => false);  // user rejects
    const handler = makeBeforeToolHandler(pm, spec, async () => true, true, approveSpec);

    const r1 = await handler(makeEvent("write", { file_path: "src/auth.ts" }));
    expect(r1).toMatchObject({ block: true });
    expect(spec.activeSpec?.approvalStatus).toBe("rejected");

    // Subsequent edit also blocked via session-wide deny rule
    const r2 = await handler(makeEvent("write", { file_path: "src/other.ts" }));
    expect(r2).toMatchObject({ block: true });
  });

  it("does not re-prompt for spec approval after approval", async () => {
    const pm = new PermissionManager();
    const spec = new SpecEngine();
    spec.classify("Refactor the auth module", true);
    const approveSpec = vi.fn(async () => true);
    const handler = makeBeforeToolHandler(pm, spec, async () => true, true, approveSpec);

    await handler(makeEvent("write", { file_path: "src/auth.ts" }));
    await handler(makeEvent("write", { file_path: "src/auth2.ts" }));
    expect(approveSpec).toHaveBeenCalledOnce();
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/hooks/before-tool.test.ts
```

**Step 3: Implement**

```typescript
// src/hooks/before-tool.ts
import { classifyRisk } from "../permissions/risk";
import type { PermissionManager } from "../permissions/manager";
import type { Capability } from "../permissions/rules";
import type { SpecEngine } from "../spec/engine";
import type { FormalSpec } from "../spec/types";

export interface BlockResult { block: true; reason: string; }
type PromptUser = (message: string) => Promise<boolean>;
type ApproveSpec = (spec: FormalSpec) => Promise<boolean>;

const TOOL_CAPABILITY: Record<string, Capability> = {
  read:  "read",
  ls:    "read",
  find:  "read",
  grep:  "read",
  write: "edit",
  edit:  "edit",
  bash:  "exec",
  task:  "task",
};

function extractTarget(toolName: string, input: Record<string, unknown>): string {
  const filePath = (input.file_path ?? input.path) as string | undefined;
  if (filePath) return filePath;
  if (input.command) return String(input.command);
  return toolName;
}

export function makeBeforeToolHandler(
  permissions: PermissionManager,
  spec: SpecEngine,
  promptUser: PromptUser,
  hasUI: boolean,
  approveSpec?: ApproveSpec,
) {
  return async (event: { toolName: string; input: Record<string, unknown> }): Promise<BlockResult | undefined> => {
    const { toolName, input } = event;
    const tier = classifyRisk(toolName, input);
    const capability = TOOL_CAPABILITY[toolName] ?? "exec";
    const target = extractTarget(toolName, input);

    // Low-risk: always allow
    if (tier === "low") return;

    // Explicit-spec approval gate (fires before normal permission flow)
    const active = spec.activeSpec;
    if (active?.approvalStatus === "pending") {
      if (!hasUI || !approveSpec) {
        return { block: true, reason: "Explicit spec needs approval but no UI available" };
      }
      const approved = await approveSpec(active);
      if (approved) {
        active.approvalStatus = "approved";
      } else {
        active.approvalStatus = "rejected";
        permissions.remember("*", "*", "deny");
        return { block: true, reason: `User rejected spec: ${active.goal}` };
      }
    }

    const decision = permissions.evaluate(capability, target);

    if (decision === "deny") {
      return { block: true, reason: `${toolName} denied (capability: ${capability})` };
    }

    if (decision === "ask" || tier === "high" || tier === "critical") {
      if (!hasUI) {
        return { block: true, reason: `${toolName} requires confirmation but no UI available` };
      }
      const label = tier === "critical" ? "⚠ CRITICAL" : "⚠ HIGH RISK";
      const allowed = await promptUser(`${label}: Allow ${toolName} on "${target}"?`);
      if (!allowed) {
        return { block: true, reason: `User denied ${toolName} on "${target}"` };
      }
      permissions.remember(capability, target, "allow");
    }
  };
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/hooks/before-tool.test.ts
```

Expected: PASS (8 tests)

**Step 5: Commit**

```bash
git add src/hooks/before-tool.ts tests/hooks/before-tool.test.ts
git commit -m "feat: add beforeToolCall — permission gate + explicit-spec approval"
```

---

## Task 12: afterToolCall Hook

**Files:**
- Create: `src/hooks/after-tool.ts`
- Create: `tests/hooks/after-tool.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/hooks/after-tool.test.ts
import { describe, it, expect } from "vitest";
import { makeAfterToolHandler } from "../../src/hooks/after-tool";
import { SpecEngine } from "../../src/spec/engine";

const makeResult = (text: string, isError = false) => ({
  toolName: "write", toolCallId: "tc-1", input: {},
  content: [{ type: "text" as const, text }],
  details: undefined, isError,
});

describe("makeAfterToolHandler", () => {
  it("records successful output in spec engine", async () => {
    const spec = new SpecEngine();
    spec.classify("Add pagination");
    await makeAfterToolHandler(spec)(makeResult("pagination added with offset and limit"));
    expect(spec.verify()[0].passed).toBe(true);
  });

  it("skips error results", async () => {
    const spec = new SpecEngine();
    spec.classify("Add pagination");
    await makeAfterToolHandler(spec)(makeResult("error: command not found", true));
    expect(spec.verify()[0].passed).toBe(false);
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- tests/hooks/after-tool.test.ts
```

**Step 3: Implement**

```typescript
// src/hooks/after-tool.ts
import type { SpecEngine } from "../spec/engine";

interface ContentBlock { type: "text" | "image"; text?: string; }

export interface ToolResultEvent {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  content: ContentBlock[];
  isError: boolean;
}

export function makeAfterToolHandler(spec: SpecEngine) {
  return async (event: ToolResultEvent): Promise<void> => {
    if (event.isError) return;
    const text = event.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join(" ");
    if (text) spec.recordToolOutput(text);
  };
}
```

**Step 4: Run test to verify pass**

```bash
npm test -- tests/hooks/after-tool.test.ts
```

**Step 5: Commit**

```bash
git add src/hooks/after-tool.ts tests/hooks/after-tool.test.ts
git commit -m "feat: add afterToolCall hook for spec output collection"
```

---

## Task 13: Extension Entry Point

Wire everything together.

**Files:**
- Modify: `src/index.ts`

**Step 1: Verify all green**

```bash
cd ~/.pi/agent/extensions/harness && npm test
```

Expected: ALL PASS

**Step 2: Implement**

```typescript
// src/index.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { PermissionManager } from "./permissions/manager";
import { SpecEngine } from "./spec/engine";
import { makeBeforeToolHandler } from "./hooks/before-tool";
import { makeAfterToolHandler } from "./hooks/after-tool";
import { TaskParamsSchema, executeTask, type TaskParams } from "./agents/task-tool";
import type { FormalSpec } from "./spec/types";

function formatSpecForApproval(spec: FormalSpec): string {
  const criteria = spec.acceptanceCriteria.map((c) => `  • ${c.description}`).join("\n");
  return `Goal: ${spec.goal}\n\nAcceptance criteria:\n${criteria}\n\nApprove?`;
}

export default function register(pi: ExtensionAPI) {
  const isSubagent = process.env.HARNESS_SUBAGENT === "1";

  const permissions = new PermissionManager();
  const spec = new SpecEngine();

  // ── --spec flag ────────────────────────────────────────────────────
  pi.registerFlag("spec", {
    type: "boolean",
    default: false,
    description: "Require approval before first edit/exec when task is ambient",
  });

  // ── Spec classification + session reset on each prompt ─────────────
  pi.on("before_agent_start", async (event) => {
    permissions.clearSessionRules();  // clear deny rules from any prior rejection
    spec.reset();
    const specFlag = pi.getFlag("spec") === true;
    spec.classify(event.prompt, specFlag);
  });

  // ── Permission + explicit-spec approval gate ───────────────────────
  pi.on("tool_call", async (event, ctx: ExtensionContext) => {
    const promptUser = (msg: string) => ctx.ui.confirm("Permission Required", msg);
    const approveSpec = (s: FormalSpec) =>
      ctx.ui.confirm("Spec Approval Required", formatSpecForApproval(s));

    const handler = makeBeforeToolHandler(
      permissions,
      spec,
      promptUser,
      ctx.hasUI,
      approveSpec,
    );
    const result = await handler(event);
    if (result?.block) return { block: true, reason: result.reason };
  });

  // ── Spec output collection ─────────────────────────────────────────
  pi.on("tool_result", async (event) => {
    await makeAfterToolHandler(spec)(event);
  });

  // ── Spec verification after each run ───────────────────────────────
  pi.on("agent_end", async (_event, ctx: ExtensionContext) => {
    const results = spec.verify();
    if (results.length === 0) return;
    const passed = results.filter((r) => r.passed).length;
    const lines = results.map((r) => `${r.passed ? "✓" : "✗"} ${r.criterion.description}`);
    const approvalNote =
      spec.activeSpec?.approvalStatus === "rejected"
        ? "\n(spec was rejected)"
        : "";
    ctx.ui.notify(
      `Spec: ${passed}/${results.length} passed${approvalNote}\n${lines.join("\n")}`,
      results.every((r) => r.passed) ? "info" : "warning",
    );
  });

  // ── Task tool (parent sessions only) ───────────────────────────────
  if (!isSubagent) {
    pi.registerTool({
      name: "task",
      label: "Delegate to specialist subagent",
      description:
        "Delegate a focused task to a specialist subagent. " +
        "Use ask to explain code, plan to design a solution, build to implement changes.",
      parameters: TaskParamsSchema,
      async execute(_toolCallId, params: TaskParams, signal, onUpdate) {
        try {
          const result = await executeTask(params, signal, onUpdate);
          return { content: [{ type: "text", text: result }] };
        } catch (err) {
          return {
            content: [{ type: "text", text: String(err) }],
            isError: true,
          };
        }
      },
    });
  }
}
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire entry point — perms, spec, task tool, --spec flag"
```

---

## Task 14: Live Integration Test

**Step 1: Start Pi**

```bash
~/.nvm/versions/node/v24.15.0/bin/pi
```

Pi auto-discovers `~/.pi/agent/extensions/harness/` via the `"pi"` field in `package.json`.

**Step 2: Test permission gate (interactive)**

```
You: Run `ls -la` in the current directory
Expected: ⚠ CRITICAL confirm dialog → y → executes
```

**Step 3: Test non-interactive block**

```bash
~/.nvm/versions/node/v24.15.0/bin/pi -p "Run ls in the current directory"
# Expected: bash blocked with "no UI available" message; agent responds in text only
```

**Step 4: Test ambient spec verification**

```
You: Add a comment to src/index.ts explaining what register() does
Expected after run: ✓/✗ notification listing criteria
```

**Step 5: Test --spec explicit approval (approve path)**

```bash
~/.nvm/versions/node/v24.15.0/bin/pi --spec
You: Refactor the auth module to use JWT
Expected: agent thinks → on first write/edit attempt, Spec Approval dialog → y → tool proceeds normally
```

**Step 6: Test --spec explicit approval (reject path)**

```bash
~/.nvm/versions/node/v24.15.0/bin/pi --spec
You: Refactor the auth module to use JWT
Expected: agent thinks → on first write/edit attempt, Spec Approval dialog → n → first tool blocked,
subsequent edit/exec attempts also blocked, read-only tools still work, final notification shows "(spec was rejected)"
```

**Step 7: Test --spec does NOT affect instant prompts**

```bash
~/.nvm/versions/node/v24.15.0/bin/pi --spec
You: What does src/index.ts do?
Expected: no approval dialog — instant tier never triggers explicit approval
```

**Step 8: Test task tool — ask specialist**

```
You: Use the task tool to ask a subagent to summarize what src/index.ts does
Expected: progress text streams as subagent works; final result returned;
subprocess ran with HARNESS_SUBAGENT=1 (no nested task tool registered);
--tools restricted to read,ls,find,grep
```

**Step 9: Test task tool — build specialist**

```
You: Use the task tool to ask a build subagent to add a hello() function to a new file
Expected: build subagent has no --tools restriction; can write files;
HARNESS_SUBAGENT=1 prevents recursive task spawning
```

---

## What's Deferred (Not v1)

- **Drift detection.** Current `targetFiles` heuristic too coarse to drive useful signals (most ambient prompts produce empty target lists). Revisit with LLM-extracted scope.
- **Rich subagent TUI.** v1 streams plain text via `onUpdate`. v2 can add usage stats, tool-call previews, collapsible items (see Pi's official subagent example).
- **In-process subagents.** All subagents subprocess-spawn per ADR 0001.
- **Git snapshots / per-step undo.**
- **LLM-based spec generation.** Currently heuristic-only.
- **Idempotency cache for read-tool deduplication.**
- **Status line / footer integration showing active session decisions.**
- **Cross-session checkpoint persistence.**
- **User-customizable agent prompts.** Currently prompts ship inside the extension repo; future versions could check `~/.pi/agent/agents/<name>.md` first as an override.
