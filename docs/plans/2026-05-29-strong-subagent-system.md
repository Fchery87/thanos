# Strong Subagent System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend Thanos's own governed `task` tool with the highest-leverage subagent upgrades — a typed result contract, an `oracle` specialist, governed clarification, artifact references, background+isolated writers, a gated `researcher`, and an opt-in forked context mode — without weakening the governance spine.

**Architecture:** Keep the existing subprocess-spawn model (ADR 0001) as the base. Evolve `src/agents/*` in place: widen the agent registry, normalize every subagent return into a `SubagentResultContract`, add a per-agent `Context Mode` (fresh default, opt-in forked for continuity roles only, per ADR 0004), and keep all new behavior flowing through policy narrowing + audit. Read-only/adversarial roles stay fresh-context and deny edit/exec.

**Tech Stack:** TypeScript (ESM), `typebox` for tool schemas, `vitest` for tests, Node child_process subprocess spawn of the `pi` binary in `--mode json`.

**Conventions (read before starting):**
- Tests use `vitest`: `import { describe, expect, it } from "vitest";` and import source from `../../src/...`.
- Run a single test file with: `npx vitest run <path>`.
- Typecheck with: `npx tsc --noEmit`. Lint with: `npx eslint src tests`.
- Domain language and decisions are in `CONTEXT.md`, `docs/adr/0001-subagent-subprocess-spawn.md`, and `docs/adr/0004-opt-in-forked-context-for-continuity-roles.md`. Re-read those three before Phase 2.
- REQUIRED SUB-SKILL for every task: @superpowers:test-driven-development (red → green → refactor).

**Role taxonomy (used throughout):**
- **Adversarial / read-only roles** (fresh-context only, deny edit+exec): `explore`, `plan`, `reviewer`, `oracle`, `researcher`.
- **Continuity roles** (may opt into forked context): `build`, `designer`.

---

## Phase 1 — The spine (concrete, code-complete)

### Task 1: Add `oracle` to the agent registry

**Files:**
- Modify: `src/agents/registry.ts`
- Test: `tests/agents/registry.test.ts` (create)

**Step 1: Write the failing test**

Create `tests/agents/registry.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { AGENT_TYPES } from "../../src/agents/registry";

describe("agent registry", () => {
  it("includes the oracle specialist", () => {
    expect(AGENT_TYPES).toContain("oracle");
  });

  it("keeps the existing specialists", () => {
    for (const t of ["explore", "plan", "build", "reviewer", "designer"]) {
      expect(AGENT_TYPES).toContain(t);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/registry.test.ts`
Expected: FAIL — `oracle` not in `AGENT_TYPES`.

**Step 3: Write minimal implementation**

Replace the contents of `src/agents/registry.ts`:

```typescript
export type AgentType = "explore" | "plan" | "build" | "reviewer" | "designer" | "oracle";

export const AGENT_TYPES: AgentType[] = ["explore", "plan", "build", "reviewer", "designer", "oracle"];
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/registry.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — expect PASS (the `task-tool.ts` schema derives literals from `AGENT_TYPES`, so `oracle` is now a valid `type` automatically).

**Step 5: Commit**

```bash
git add src/agents/registry.ts tests/agents/registry.test.ts
git commit -m "feat(agents): add oracle specialist to registry"
```

---

### Task 2: Make `oracle` a read-only/adversarial role in policy narrowing

**Files:**
- Modify: `src/agents/policy.ts:4` (the `READ_ONLY_AGENTS` array)
- Test: `tests/agents/policy.test.ts` (extend)

**Step 1: Write the failing test**

In `tests/agents/policy.test.ts`, inside the existing `describe("narrowPolicyForAgent", ...)`, add a new block after the `read-only agents` describe:

```typescript
  describe("oracle (adversarial, read-only)", () => {
    it("cannot exec", () => {
      const narrowed = narrowPolicyForAgent("oracle", basePolicy);
      const result = evaluatePolicy(narrowed, "exec", "somecommand");
      expect(result?.decision).toBe("deny");
    });

    it("cannot edit", () => {
      const narrowed = narrowPolicyForAgent("oracle", basePolicy);
      const result = evaluatePolicy(narrowed, "edit", "somefile.ts");
      expect(result?.decision).toBe("deny");
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/policy.test.ts`
Expected: FAIL — `oracle` is not in `READ_ONLY_AGENTS`, so `evaluatePolicy` returns `null`.

**Step 3: Write minimal implementation**

In `src/agents/policy.ts`, change the `READ_ONLY_AGENTS` constant:

```typescript
const READ_ONLY_AGENTS: AgentType[] = ["explore", "plan", "reviewer", "oracle"];
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/policy.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/agents/policy.ts tests/agents/policy.test.ts
git commit -m "feat(agents): treat oracle as read-only in policy narrowing"
```

---

### Task 3: Create the `oracle` agent definition

**Files:**
- Create: `agent/agents/oracle.md`
- Test: `tests/agents/loader.test.ts` (extend the "every agent type" test)

**Step 1: Write the failing test**

In `tests/agents/loader.test.ts`, update the final test's `types` array to include `oracle`:

```typescript
  it("every agent type has a definition file with a tools allowlist", async () => {
    const types = ["explore", "plan", "build", "reviewer", "designer", "oracle"] as const;
    for (const type of types) {
      const def = await loadAgent(type);
      expect(def.tools, `${type} should have tools defined`).toBeDefined();
      expect(def.tools!.length, `${type} tools should not be empty`).toBeGreaterThan(0);
    }
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/loader.test.ts`
Expected: FAIL — no `oracle.md`, so `loadAgent("oracle")` falls back with no `tools`.

**Step 3: Write minimal implementation**

Create `agent/agents/oracle.md`:

```markdown
---
tools: read, ls, find, grep
maxTurns: 25
---
You are Oracle. You provide an unbiased second opinion: challenge assumptions, audit plans and diffs, and surface risks the author missed. You are read-only — you do not edit files or run commands, and you never defer to the parent's prior decisions just because they were made.

Return a structured verdict: the single most important risk first, then a short list of concrete concerns with file/line evidence where it exists, then what you would do differently. If the plan or change is sound, say so plainly and explain why — do not invent objections to seem useful.
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/loader.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add agent/agents/oracle.md tests/agents/loader.test.ts
git commit -m "feat(agents): add oracle agent definition (read-only)"
```

---

### Task 4: Define the `SubagentResultContract` type and parser

**Files:**
- Modify: `src/agents/result.ts` (full rewrite)
- Test: `tests/agents/result.test.ts` (create)

**Step 1: Write the failing test**

Create `tests/agents/result.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseSubagentResult } from "../../src/agents/result";

describe("parseSubagentResult", () => {
  it("wraps plain text as a success contract with empty collections", () => {
    const c = parseSubagentResult("just some prose");
    expect(c).toEqual({
      status: "success",
      summary: "just some prose",
      findings: [],
      artifacts: [],
      escalations: [],
    });
  });

  it("normalizes a full contract JSON, filling missing collections", () => {
    const c = parseSubagentResult(JSON.stringify({ status: "error", summary: "boom" }));
    expect(c.status).toBe("error");
    expect(c.summary).toBe("boom");
    expect(c.findings).toEqual([]);
    expect(c.artifacts).toEqual([]);
    expect(c.escalations).toEqual([]);
  });

  it("preserves provided findings, artifacts, escalations, and metadata", () => {
    const c = parseSubagentResult(JSON.stringify({
      status: "escalated",
      summary: "need input",
      findings: [{ priority: "P1", summary: "missing test" }],
      artifacts: [{ name: "report.md", path: ".harness/x", bytes: 10 }],
      escalations: [{ question: "which db?" }],
      metadata: { turns: 3 },
    }));
    expect(c.findings).toHaveLength(1);
    expect(c.artifacts[0].name).toBe("report.md");
    expect(c.escalations[0].question).toBe("which db?");
    expect(c.metadata).toEqual({ turns: 3 });
  });

  it("accepts the legacy { text, metadata } shape for backward compatibility", () => {
    const c = parseSubagentResult(JSON.stringify({ text: "legacy", metadata: { a: 1 } }));
    expect(c.status).toBe("success");
    expect(c.summary).toBe("legacy");
    expect(c.metadata).toEqual({ a: 1 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/result.test.ts`
Expected: FAIL — current `parseSubagentResult` returns `{ text, metadata? }`, not the contract.

**Step 3: Write minimal implementation**

Replace the contents of `src/agents/result.ts`:

```typescript
export type SubagentStatus = "success" | "error" | "timeout" | "escalated";

export interface Finding {
  priority: "P0" | "P1" | "P2" | "P3";
  summary: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface ArtifactRef {
  name: string;
  path: string;
  bytes: number;
}

export interface Escalation {
  question: string;
  options?: string[];
  recommended?: string;
}

export interface SubagentResultContract {
  status: SubagentStatus;
  summary: string;
  findings: Finding[];
  artifacts: ArtifactRef[];
  escalations: Escalation[];
  metadata?: Record<string, unknown>;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function plainText(summary: string): SubagentResultContract {
  return { status: "success", summary, findings: [], artifacts: [], escalations: [] };
}

export function parseSubagentResult(text: string): SubagentResultContract {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return plainText(text);
  }

  if (!parsed || typeof parsed !== "object") return plainText(text);
  const obj = parsed as Record<string, unknown>;

  // Canonical contract: has a string `summary`.
  if (typeof obj.summary === "string") {
    const contract: SubagentResultContract = {
      status: (obj.status as SubagentStatus) ?? "success",
      summary: obj.summary,
      findings: asArray<Finding>(obj.findings),
      artifacts: asArray<ArtifactRef>(obj.artifacts),
      escalations: asArray<Escalation>(obj.escalations),
    };
    if (obj.metadata && typeof obj.metadata === "object") {
      contract.metadata = obj.metadata as Record<string, unknown>;
    }
    return contract;
  }

  // Legacy { text, metadata } shape.
  if (typeof obj.text === "string") {
    const contract = plainText(obj.text);
    if (obj.metadata && typeof obj.metadata === "object") {
      contract.metadata = obj.metadata as Record<string, unknown>;
    }
    return contract;
  }

  return plainText(text);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/result.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — expect FAIL in `src/agents/task-tool.ts` (it references `parsed.text`). That is fixed in Task 5.

**Step 5: Commit**

```bash
git add src/agents/result.ts tests/agents/result.test.ts
git commit -m "feat(agents): add typed SubagentResultContract and parser"
```

---

### Task 5: Wire the contract into the task-tool close handler

**Files:**
- Modify: `src/agents/task-tool.ts` (the `child.on("close", ...)` block, ~lines 246-266) and `src/agents/transcripts.ts` (status type)
- Test: `tests/agents/task-tool.test.ts` (extend) — test pure extracted helpers, not the spawn

**Step 1: Write the failing test**

First, we will extract two pure helpers so they are testable without spawning a process. In `tests/agents/task-tool.test.ts`, add:

```typescript
import { contractToTranscriptStatus, contractReturnPayload } from "../../src/agents/task-tool";
import type { SubagentResultContract } from "../../src/agents/result";

describe("task-tool contract helpers", () => {
  const base: SubagentResultContract = {
    status: "success", summary: "ok", findings: [], artifacts: [], escalations: [],
  };

  it("maps contract status to a transcript status", () => {
    expect(contractToTranscriptStatus({ ...base, status: "success" })).toBe("success");
    expect(contractToTranscriptStatus({ ...base, status: "error" })).toBe("error");
    expect(contractToTranscriptStatus({ ...base, status: "timeout" })).toBe("timeout");
    expect(contractToTranscriptStatus({ ...base, status: "escalated" })).toBe("escalated");
  });

  it("returns the full contract as a JSON string payload", () => {
    const payload = contractReturnPayload(base);
    expect(JSON.parse(payload)).toEqual(base);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/task-tool.test.ts`
Expected: FAIL — `contractToTranscriptStatus` / `contractReturnPayload` are not exported.

**Step 3: Write minimal implementation**

In `src/agents/transcripts.ts`, widen the status type:

```typescript
  status: "success" | "error" | "timeout" | "escalated";
```

In `src/agents/task-tool.ts`, add these exported helpers near the top (after the imports):

```typescript
import type { SubagentResultContract } from "./result";

export function contractToTranscriptStatus(
  c: SubagentResultContract,
): "success" | "error" | "timeout" | "escalated" {
  return c.status;
}

export function contractReturnPayload(c: SubagentResultContract): string {
  return JSON.stringify(c);
}
```

Then replace the body of the `child.on("close", (code) => { ... })` handler so it uses the contract. The new handler:

```typescript
    child.on("close", (code) => {
      cleanup();
      const endedAt = new Date().toISOString();
      const finalText = resolveFinalText({
        stdout,
        code,
        timedOut,
        timeoutMs: agent.timeoutMs,
      });
      const contract = parseSubagentResult(finalText);
      // The harness owns the authoritative run status; only override the
      // contract status when the run itself failed at the process level.
      if (timedOut) contract.status = "timeout";
      else if (code !== 0 && code !== null) contract.status = "error";
      writeTranscriptMetadata(path.join(process.cwd(), ".harness", "subagents"), {
        agentType: params.type,
        status: contractToTranscriptStatus(contract),
        summary: contract.summary.slice(0, 500),
        startedAt,
        endedAt,
        metadata: contract.metadata,
      }).catch(() => {});
      resolve(contractReturnPayload(contract));
    });
```

(Confirm `parseSubagentResult` is already imported at the top of `task-tool.ts` — it is, via `import { parseSubagentResult } from "./result";`.)

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/task-tool.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — expect PASS (the `parsed.text` reference is gone). Then run the whole agent suite: `npx vitest run tests/agents/` — expect PASS.

**Step 5: Commit**

```bash
git add src/agents/task-tool.ts src/agents/transcripts.ts tests/agents/task-tool.test.ts
git commit -m "feat(agents): return typed result contract from task tool"
```

---

### Task 6: Parse the `context` mode from agent frontmatter

**Files:**
- Modify: `src/agents/loader.ts` (the `AgentDefinition` interface + `parseFrontmatter` loop)
- Test: `tests/agents/loader.test.ts` (extend)

**Step 1: Write the failing test**

In `tests/agents/loader.test.ts`, add inside `describe("loadAgent", ...)`:

```typescript
  it("parses an explicit context mode from frontmatter", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-agent-"));
    process.env.HOME = home;
    const agentDir = join(home, ".pi", "agent", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "designer.md"),
      ["---", "tools: read, edit", "context: forked", "---", "You are Designer."].join("\n"),
      "utf-8",
    );
    const agent = await loadAgent("designer");
    expect(agent.context).toBe("forked");
  });

  it("leaves context undefined when not specified", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-agent-"));
    process.env.HOME = home;
    const agentDir = join(home, ".pi", "agent", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "explore.md"),
      ["---", "tools: read", "---", "You are Explore."].join("\n"),
      "utf-8",
    );
    const agent = await loadAgent("explore");
    expect(agent.context).toBeUndefined();
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/loader.test.ts`
Expected: FAIL — `agent.context` is `undefined` even when `context: forked` is present (and the type lacks the field).

**Step 3: Write minimal implementation**

In `src/agents/loader.ts`, add to the `AgentDefinition` interface:

```typescript
  context?: "fresh" | "forked";
```

In `parseFrontmatter`, add a handler inside the key loop (alongside the `model` handler):

```typescript
    if (key === "context") {
      const mode = parseStringScalar(rawValue);
      if (mode === "fresh" || mode === "forked") parsed.context = mode;
      continue;
    }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/loader.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/agents/loader.ts tests/agents/loader.test.ts
git commit -m "feat(agents): parse opt-in context mode from frontmatter"
```

---

### Task 7: Resolve + validate context mode (refuse forked for adversarial roles)

**Files:**
- Create: `src/agents/context-mode.ts`
- Test: `tests/agents/context-mode.test.ts` (create)

This enforces ADR 0004: fresh is the default; forked is allowed only for continuity roles; requesting forked for an adversarial role is a hard error, not a silent downgrade.

**Step 1: Write the failing test**

Create `tests/agents/context-mode.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveContextMode } from "../../src/agents/context-mode";

describe("resolveContextMode", () => {
  it("defaults to fresh when unspecified", () => {
    expect(resolveContextMode("build", undefined)).toBe("fresh");
    expect(resolveContextMode("oracle", undefined)).toBe("fresh");
  });

  it("allows forked for continuity roles", () => {
    expect(resolveContextMode("build", "forked")).toBe("forked");
    expect(resolveContextMode("designer", "forked")).toBe("forked");
  });

  it("allows an explicit fresh for any role", () => {
    expect(resolveContextMode("oracle", "fresh")).toBe("fresh");
    expect(resolveContextMode("designer", "fresh")).toBe("fresh");
  });

  it.each(["explore", "plan", "reviewer", "oracle", "researcher"] as const)(
    "throws when forked is requested for adversarial role %s",
    (type) => {
      expect(() => resolveContextMode(type, "forked")).toThrow(/forked/i);
    },
  );
});
```

(Note: `researcher` is added to the registry in Task 9. If executing strictly in order, either move this `researcher` case to Task 9 or do Task 9 first. They are independent; recommended order is 9 before 7's `researcher` assertion — but the helper logic below already lists `researcher` so the test will pass once Task 9 lands. If running 7 before 9, temporarily drop `researcher` from the `it.each` list and add it back in Task 9.)

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/context-mode.test.ts`
Expected: FAIL — module does not exist.

**Step 3: Write minimal implementation**

Create `src/agents/context-mode.ts`:

```typescript
import type { AgentType } from "./registry";

export type ContextMode = "fresh" | "forked";

// Continuity roles may inherit the parent's context; everything else is
// adversarial/read-only and must run fresh to stay unbiased (see ADR 0004).
const CONTINUITY_ROLES: AgentType[] = ["build", "designer"];

export function resolveContextMode(type: AgentType, requested: ContextMode | undefined): ContextMode {
  if (requested === undefined) return "fresh";
  if (requested === "fresh") return "fresh";
  // requested === "forked"
  if (!CONTINUITY_ROLES.includes(type)) {
    throw new Error(
      `Agent "${type}" may not run in forked context: forked is limited to continuity roles (${CONTINUITY_ROLES.join(", ")}). See ADR 0004.`,
    );
  }
  return "forked";
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/context-mode.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/agents/context-mode.ts tests/agents/context-mode.test.ts
git commit -m "feat(agents): resolve and validate context mode per ADR 0004"
```

---

### Task 8: Wire context mode into the spawn invocation

**Files:**
- Modify: `src/agents/task-tool.ts` (`executeTask`, the `piArgs` construction)
- Test: extract a pure `buildContextArgs` helper and test it

**IMPORTANT — verify the Pi flag first.** The fresh path currently uses `--no-session`. The forked path needs Pi's forked-session flag, whose exact name must be confirmed before coding. Run `pi --help` (or check the installed `@earendil-works/pi-coding-agent` CLI docs) and find the forked-session flag. The implementation below uses `--fork-session` as a **placeholder** — replace it with the real flag. If Pi exposes no forked-session flag yet, stop and report: forked mode cannot be implemented, and Task 8 + the forked parts of Task 7 should be deferred (the validation in Task 7 still stands as a guard).

**Step 1: Write the failing test**

In a new `tests/agents/context-mode.test.ts` block (same file as Task 7), add:

```typescript
import { buildContextArgs } from "../../src/agents/context-mode";

describe("buildContextArgs", () => {
  it("uses an isolated session for fresh mode", () => {
    expect(buildContextArgs("fresh")).toEqual(["--no-session"]);
  });

  it("uses the fork flag for forked mode", () => {
    // Replace with the verified Pi flag.
    expect(buildContextArgs("forked")).toEqual(["--fork-session"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/context-mode.test.ts`
Expected: FAIL — `buildContextArgs` not exported.

**Step 3: Write minimal implementation**

Add to `src/agents/context-mode.ts`:

```typescript
export function buildContextArgs(mode: ContextMode): string[] {
  // NOTE: confirm the forked flag against `pi --help` before trusting this.
  return mode === "forked" ? ["--fork-session"] : ["--no-session"];
}
```

Then in `src/agents/task-tool.ts`, in `executeTask`, replace the hard-coded `--no-session` in the `piArgs` array:

```typescript
  const contextMode = resolveContextMode(params.type, agent.context);
  const piArgs: string[] = ["--mode", "json", "-p", ...buildContextArgs(contextMode), ...];
```

Add the imports at the top of `task-tool.ts`:

```typescript
import { resolveContextMode, buildContextArgs } from "./context-mode";
```

Also record the context mode in the transcript metadata so audit can interpret the run. In the close handler's `writeTranscriptMetadata` call, extend `metadata`:

```typescript
        metadata: { ...(contract.metadata ?? {}), contextMode },
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/context-mode.test.ts` — expect PASS.
Then `npx tsc --noEmit` — expect PASS.
Then the full suite: `npx vitest run` — expect PASS.

**Step 5: Commit**

```bash
git add src/agents/task-tool.ts src/agents/context-mode.ts tests/agents/context-mode.test.ts
git commit -m "feat(agents): select fresh/forked session per resolved context mode"
```

---

### Task 9: Add the `researcher` specialist (read-only, network-gated)

**Files:**
- Modify: `src/agents/registry.ts`, `src/agents/policy.ts`
- Create: `agent/agents/researcher.md`
- Test: `tests/agents/registry.test.ts`, `tests/agents/policy.test.ts`

**Step 1: Write the failing tests**

In `tests/agents/registry.test.ts`:

```typescript
  it("includes the researcher specialist", () => {
    expect(AGENT_TYPES).toContain("researcher");
  });
```

In `tests/agents/policy.test.ts`, add a block:

```typescript
  describe("researcher (read-only, network-gated)", () => {
    it("cannot edit", () => {
      const narrowed = narrowPolicyForAgent("researcher", basePolicy);
      expect(evaluatePolicy(narrowed, "edit", "f.ts")?.decision).toBe("deny");
    });
    it("cannot exec", () => {
      const narrowed = narrowPolicyForAgent("researcher", basePolicy);
      expect(evaluatePolicy(narrowed, "exec", "curl x")?.decision).toBe("deny");
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/agents/registry.test.ts tests/agents/policy.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

`src/agents/registry.ts`:

```typescript
export type AgentType = "explore" | "plan" | "build" | "reviewer" | "designer" | "oracle" | "researcher";

export const AGENT_TYPES: AgentType[] = ["explore", "plan", "build", "reviewer", "designer", "oracle", "researcher"];
```

`src/agents/policy.ts` — add `researcher` to `READ_ONLY_AGENTS`:

```typescript
const READ_ONLY_AGENTS: AgentType[] = ["explore", "plan", "reviewer", "oracle", "researcher"];
```

Create `agent/agents/researcher.md`:

```markdown
---
tools: read, ls, find, grep, web_search, fetch_content
maxTurns: 25
---
You are Researcher. You gather facts from the web and project docs and return sourced findings — every non-obvious claim carries a URL or file reference. You are read-only: you do not edit files or run shell commands. Distinguish what you verified from what you inferred. If sources conflict, say so rather than picking silently.
```

> Network governance note: `web_search`/`fetch_content` are governed separately from `exec`. Per `CONTEXT.md` ("network commands require explicit policy"), a follow-up should add an explicit policy classification for these web tools. This task ships the role with the tools allow-listed; the policy classification is tracked separately and is out of scope here.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agents/` — expect PASS. Add `researcher` to the loader "every agent type" array (as in Task 3) and re-run. `npx tsc --noEmit` — expect PASS.

**Step 5: Commit**

```bash
git add src/agents/registry.ts src/agents/policy.ts agent/agents/researcher.md tests/agents/
git commit -m "feat(agents): add read-only researcher specialist"
```

---

### Task 10: Artifact reference helper

**Files:**
- Create: `src/agents/artifacts.ts`
- Test: `tests/agents/artifacts.test.ts` (create)

Keeps large subagent output out of the orchestrator's context: write to disk under `.harness/subagents/artifacts/`, return an `ArtifactRef`.

**Step 1: Write the failing test**

Create `tests/agents/artifacts.test.ts`:

```typescript
import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeArtifact } from "../../src/agents/artifacts";

let dir: string | undefined;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe("writeArtifact", () => {
  it("writes content to the artifacts dir and returns a ref with byte size", async () => {
    dir = await mkdtemp(join(tmpdir(), "thanos-artifacts-"));
    const content = "# Report\nsome long output";
    const ref = await writeArtifact(dir, "report.md", content);

    expect(ref.name).toBe("report.md");
    expect(ref.bytes).toBe(Buffer.byteLength(content, "utf-8"));
    expect(ref.path).toContain("artifacts");
    expect(await readFile(ref.path, "utf-8")).toBe(content);
  });

  it("sanitizes unsafe names to a flat file", async () => {
    dir = await mkdtemp(join(tmpdir(), "thanos-artifacts-"));
    const ref = await writeArtifact(dir, "../../etc/passwd", "x");
    expect(ref.path).not.toContain("..");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/artifacts.test.ts`
Expected: FAIL — module does not exist.

**Step 3: Write minimal implementation**

Create `src/agents/artifacts.ts`:

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { ArtifactRef } from "./result";

export async function writeArtifact(baseDir: string, name: string, content: string): Promise<ArtifactRef> {
  const safeName = basename(name).replace(/[^A-Za-z0-9._-]/g, "_") || "artifact";
  const artifactsDir = join(baseDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  const filePath = join(artifactsDir, safeName);
  await writeFile(filePath, content, "utf-8");
  return { name: safeName, path: filePath, bytes: Buffer.byteLength(content, "utf-8") };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/artifacts.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/agents/artifacts.ts tests/agents/artifacts.test.ts
git commit -m "feat(agents): add artifact reference helper"
```

---

### Phase 1 checkpoint

Run the full verification before moving on:

```bash
npx tsc --noEmit && npx eslint src tests && npx vitest run
```

Expected: all PASS. At this point you have: `oracle` + `researcher` specialists (governed read-only), a typed result contract returned by every subagent, transcript status/contextMode recorded for audit, opt-in forked context validated per ADR 0004, and an artifact helper. Commit any final cleanup.

---

## Phase 2 — Governed clarification & background execution (integration-heavy)

These two touch surfaces this plan did not fully read (the Ask tool implementation and the extension's tool registration / streaming loop). **Each Phase 2 task begins with a reconnaissance step** so the implementer fills exact integration points before writing code. Do not skip the recon steps.

### Task 11: Governed clarification via the Ask tool (`escalations[]`)

**Goal:** When a subagent genuinely needs user input, it raises a typed request that surfaces to the *parent* (which owns all user communication) via the contract's `escalations[]` field — never a child→user side-channel.

**Step 1 (recon):** Read the Ask tool implementation and how interaction tools are registered. Find them:

```bash
grep -rn "ask" src/ --include=*.ts -l
grep -rn "report_finding\|interaction" src/ --include=*.ts -l
```

Document: the Ask tool's input/output schema, and whether a subagent (with `HARNESS_SUBAGENT=1`) currently has the Ask tool registered.

**Step 2 (design, write into this file under this task):** Decide how a child emits an escalation. Recommended: the child includes `escalations[]` in its returned contract (already supported by Task 4's parser). The parent, on receiving a contract with `status: "escalated"` or a non-empty `escalations[]`, presents the question(s) through its own Ask tool and may re-dispatch the child with the answer as added `context`.

**Step 3 (failing test):** In `tests/agents/result.test.ts`, assert a child contract with escalations round-trips and is detectable:

```typescript
it("flags a contract that requires parent clarification", () => {
  const c = parseSubagentResult(JSON.stringify({
    status: "escalated", summary: "blocked", escalations: [{ question: "which db?", options: ["pg", "sqlite"], recommended: "pg" }],
  }));
  expect(c.status).toBe("escalated");
  expect(c.escalations[0].recommended).toBe("pg");
});
```

**Step 4:** Add a pure helper `needsClarification(contract): boolean` in `src/agents/result.ts` (`status === "escalated" || escalations.length > 0`) with a test, then wire the parent-side handling at the task-tool call site discovered in recon. Keep parent-owns-user-comms invariant.

**Step 5:** `npx vitest run tests/agents/` + `npx tsc --noEmit`, then commit:

```bash
git commit -am "feat(agents): governed child-to-parent clarification via escalations"
```

### Task 12: Background execution + worktree isolation for any writer

**Goal:** Allow a subagent to run in the background (continue across the parent's turn) and give worktree isolation to *any* writing agent, not just `build`.

**Step 1 (recon):** Read how the `task` tool is registered and how results are delivered to the parent today (the extension entry — `src/index.ts` — and the `onUpdate` streaming path in `task-tool.ts`). Determine whether Pi's tool API supports returning a handle and delivering a later result, or whether background results must be polled from `.harness/subagents/`.

**Step 2 (design decision — RESOLVE HERE):** Pick the background result-delivery model:
- (a) re-inject the contract when the background run finishes, or
- (b) write the contract to `.harness/subagents/<id>.json` for the parent to poll.
Record the choice and why. Default recommendation: **(b)** — it keeps the orchestrator context lean (the parent reads only when it asks) and reuses the existing transcript-writing path.

**Step 3 (worktree generalization, TDD):** In `src/agents/task-tool.ts`, the worktree is currently created only for `params.type === "build"`. Replace that gate with a capability check: create a worktree for any agent whose resolved policy permits `edit`. Extract a pure helper `agentWrites(type): boolean` (returns true for `build`, `designer`, and any future writer) and test it in a new `tests/agents/writers.test.ts`. Then use it at the worktree-creation site.

**Step 4:** Implement the chosen background model behind a new optional `background?: boolean` field on the task params schema (`TaskParamsSchema` in `task-tool.ts`). Foreground stays the default. Add a schema test to `tests/agents/task-tool.test.ts` asserting `background` is optional and boolean.

**Step 5:** `npx vitest run` + `npx tsc --noEmit`, then commit:

```bash
git commit -am "feat(agents): background execution and worktree isolation for writers"
```

### Phase 2 checkpoint

```bash
npx tsc --noEmit && npx eslint src tests && npx vitest run
```

Update `CONTEXT.md` if any Phase 2 design decision (background delivery model, web-tool network policy) resolved a flagged ambiguity, and add an ADR if the background-delivery choice turns out to be hard-to-reverse + surprising + a real trade-off.

---

## Out of scope (explicitly deferred)

- **Forked broadly available to review/oracle** — rejected by ADR 0004; do not add.
- **`delegate` / `context-builder` roles** — rejected as redundant in `CONTEXT.md`.
- **Chain templates (`.chain.md`)** — deferred; revisit after Phase 2.
- **Network policy classification for `web_search`/`fetch_content`** — tracked as a follow-up from Task 9, not built here.
