# Delivery Modes + Yolo Lockout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-project delivery modes (policy ceiling + ship contract + autonomy) with a captain/repo trust-split, and harden the global yolo into a lockable switch.

**Architecture:** A session resolves one `ResolvedDelivery` from a captain-owned registry (`~/.pi/agent/projects.json`, trusted) overlaid with a repo-committed ship file (`.thanos/delivery.json`, untrusted, ship-mechanics only). The policy-ceiling half overlays `PolicyRule[]` onto the existing `HarnessPolicy` so the current `pi.on("tool_call")` evaluator enforces it with no new eval logic. The autonomy half is one new branch in `before-tool.ts`. Yolo gains a hard lock in `PermissionManager`.

**Tech Stack:** TypeScript, TypeBox (schemas), vitest, bun. Existing modules: `src/permissions`, `src/policy`, `src/governance`, `src/hooks`.

**Reference design:** `docs/plans/2026-06-23-thanos-delivery-modes-design.md` (read it first).

**Conventions:** TDD (test first, watch it fail, minimal impl, watch it pass, commit). DRY. YAGNI. One commit per task. Run `bun run typecheck` before each commit. Tests: `bunx vitest run <path>`.

---

### Task 1: Yolo hard-lock in PermissionManager

**Files:**
- Modify: `src/permissions/manager.ts`
- Test: `tests/permissions/yolo-lock.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { PermissionManager } from "../../src/permissions/manager";

describe("PermissionManager yolo lock", () => {
  it("forces yolo off and makes setYolo(true) a no-op when locked", () => {
    const pm = new PermissionManager();
    pm.lockYolo();
    expect(pm.yoloLocked).toBe(true);
    expect(pm.isYolo).toBe(false);
    pm.setYolo(true);
    expect(pm.isYolo).toBe(false);
  });

  it("evaluates with rules (not allow-all) when locked", () => {
    const pm = new PermissionManager();
    pm.lockYolo();
    expect(pm.evaluate("edit", "src/x.ts")).toBe("ask"); // default edit rule
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/permissions/yolo-lock.test.ts`
Expected: FAIL — `pm.lockYolo is not a function`.

**Step 3: Write minimal implementation**

In `src/permissions/manager.ts`, add field + methods and gate `setYolo`/`isYolo`:

```ts
  private _locked = false;

  get yoloLocked(): boolean { return this._locked; }

  lockYolo(): void {
    this._locked = true;
    this._yolo = false;
  }

  get isYolo(): boolean { return this._locked ? false : this._yolo; }

  setYolo(enabled: boolean): void {
    if (this._locked) return;
    this._yolo = enabled;
  }
```

(Replace the existing `get isYolo` and `setYolo`.)

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/permissions/yolo-lock.test.ts` → PASS.
Also run existing perms tests: `bunx vitest run tests/permissions` → all PASS (lock is opt-in, default behavior unchanged).

**Step 5: Commit**

```bash
git add src/permissions/manager.ts tests/permissions/yolo-lock.test.ts
git commit -m "feat(permissions): add hard yolo lock to PermissionManager"
```

---

### Task 2: Lockout wiring + /yolo refusal (env source)

**Files:**
- Modify: `src/index.ts` (the `register()` body near `const permissions = new PermissionManager();` ~`:127`; the `/yolo` command ~`:347`; the Ctrl+Shift+Y handler ~`:1148`; the `session_start` status block ~`:155`)
- Test: `tests/permissions/yolo-lock.test.ts` (extend) — pure helper test below

**Step 1: Write the failing test for the config helper**

Create `src/permissions/yolo-config.ts` contract first via test `tests/permissions/yolo-config.test.ts`:

```ts
import { describe, expect, it, afterEach } from "vitest";
import { yoloDisabledByEnv } from "../../src/permissions/yolo-config";

afterEach(() => { delete process.env.THANOS_YOLO_DISABLED; });

describe("yoloDisabledByEnv", () => {
  it("is true when THANOS_YOLO_DISABLED=1", () => {
    process.env.THANOS_YOLO_DISABLED = "1";
    expect(yoloDisabledByEnv()).toBe(true);
  });
  it("is false when unset", () => {
    expect(yoloDisabledByEnv()).toBe(false);
  });
});
```

**Step 2: Run → FAIL** (`Cannot find module yolo-config`).

**Step 3: Implement**

Create `src/permissions/yolo-config.ts`:

```ts
export function yoloDisabledByEnv(): boolean {
  return process.env.THANOS_YOLO_DISABLED?.trim() === "1";
}
```

Then wire in `src/index.ts`:
- After `const permissions = new PermissionManager();` and the `initialYolo` block, add:
  ```ts
  if (yoloDisabledByEnv()) permissions.lockYolo();
  ```
  (import `yoloDisabledByEnv` at top.)
- In **both** `/yolo` toggle handlers (`:347` and `:1148`), at the top of the handler add:
  ```ts
  if (permissions.yoloLocked) {
    ctx.ui.notify("Yolo is disabled by configuration.", "warning");
    return;
  }
  ```
- In the `session_start` status block (`:155`), the `if (permissions.isYolo)` guard already prevents showing `⚡ yolo` when locked (isYolo is false). No change needed there.

**Step 4: Verify**

Run: `bunx vitest run tests/permissions` → PASS. `bun run typecheck` → clean.

**Step 5: Commit**

```bash
git add src/permissions/yolo-config.ts tests/permissions/yolo-config.test.ts src/index.ts
git commit -m "feat(permissions): lock yolo via THANOS_YOLO_DISABLED and refuse /yolo when locked"
```

---

### Task 3: Delivery schemas (TypeBox) + parsing

**Files:**
- Create: `src/governance/delivery-types.ts`
- Test: `tests/governance/delivery-types.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseRegistry, parseShipFile } from "../../src/governance/delivery-types";

describe("delivery schemas", () => {
  it("parses a valid registry", () => {
    const r = parseRegistry({ version: 1, default: { mode: "local-only", autonomy: "attended" }, projects: [] });
    expect(r.default.mode).toBe("local-only");
  });
  it("rejects an unknown mode", () => {
    expect(() => parseRegistry({ version: 1, default: { mode: "wat", autonomy: "attended" }, projects: [] })).toThrow();
  });
  it("parses a ship file with gates", () => {
    const s = parseShipFile({ version: 1, gates: { test: "bun test" }, defaultBranch: "main", merge: "fast-forward" });
    expect(s.gates.test).toBe("bun test");
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** `src/governance/delivery-types.ts`:

```ts
import { Type, type Static } from "typebox";
import { Value } from "typebox/value"; // adjust import to match repo's typebox usage in src/agents/task-tool.ts

export const Mode = Type.Union([
  Type.Literal("local-only"), Type.Literal("direct-PR"), Type.Literal("no-mistakes"),
]);
export const Autonomy = Type.Union([Type.Literal("attended"), Type.Literal("unattended")]);

export const RegistrySchema = Type.Object({
  version: Type.Literal(1),
  yolo: Type.Optional(Type.Union([Type.Literal("disabled")])),
  default: Type.Object({ mode: Mode, autonomy: Autonomy }),
  projects: Type.Array(Type.Object({
    match: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
    mode: Mode,
    autonomy: Autonomy,
    yolo: Type.Optional(Type.Union([Type.Literal("locked"), Type.Literal("inherit")])),
  })),
});
export type Registry = Static<typeof RegistrySchema>;

export const ShipSchema = Type.Object({
  version: Type.Literal(1),
  gates: Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()])),
  defaultBranch: Type.Optional(Type.String()),
  merge: Type.Optional(Type.Union([Type.Literal("fast-forward"), Type.Literal("pr")])),
});
export type ShipFile = Static<typeof ShipSchema>;

function parse<T>(schema: Parameters<typeof Value.Decode>[0], input: unknown, label: string): T {
  if (!Value.Check(schema, input)) throw new Error(`Invalid ${label}`);
  return input as T;
}
export const parseRegistry = (i: unknown): Registry => parse(RegistrySchema, i, "delivery registry");
export const parseShipFile = (i: unknown): ShipFile => parse(ShipSchema, i, "ship file");
```

> NOTE for implementer: match the exact `typebox` import/validation style already used in `src/agents/task-tool.ts` and `src/policy/schema.ts` — use whatever `Check`/`parse` helper those files use rather than the sketch above.

**Step 4: Verify** → `bunx vitest run tests/governance/delivery-types.test.ts` PASS.

**Step 5: Commit**

```bash
git add src/governance/delivery-types.ts tests/governance/delivery-types.test.ts
git commit -m "feat(governance): delivery registry + ship-file schemas"
```

---

### Task 4: Delivery resolution with trust-split + fail-safe

**Files:**
- Create: `src/governance/delivery.ts`
- Test: `tests/governance/delivery.test.ts`

**Step 1: Write the failing tests** (core security + precedence + fail-safe)

```ts
import { describe, expect, it } from "vitest";
import { resolveDelivery } from "../../src/governance/delivery";

const SAFE = { mode: "local-only", autonomy: "attended" };

describe("resolveDelivery", () => {
  it("returns safe default when nothing matches", () => {
    const r = resolveDelivery({ registry: null, shipFile: null, repoId: { remote: null, path: "/x" } });
    expect(r.mode).toBe("local-only");
    expect(r.autonomy).toBe("attended");
  });

  it("matches a project by remote and applies its trusted mode/autonomy", () => {
    const registry = { version: 1, default: SAFE, projects: [
      { match: "git@github.com:me/repo.git", mode: "no-mistakes", autonomy: "unattended" },
    ]};
    const r = resolveDelivery({ registry, shipFile: null, repoId: { remote: "git@github.com:me/repo.git", path: "/x" }});
    expect(r.mode).toBe("no-mistakes");
    expect(r.autonomy).toBe("unattended");
  });

  it("IGNORES mode/autonomy from the committed ship file (trust-split)", () => {
    const shipFile = { version: 1, gates: { test: "t" }, mode: "no-mistakes", autonomy: "unattended" } as any;
    const r = resolveDelivery({ registry: null, shipFile, repoId: { remote: null, path: "/x" }});
    expect(r.mode).toBe("local-only");      // ship file cannot raise mode
    expect(r.autonomy).toBe("attended");    // ship file cannot grant autonomy
    expect(r.gates.test).toBe("t");         // but ship mechanics are honored
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** `src/governance/delivery.ts`:

```ts
import type { Registry, ShipFile } from "./delivery-types";

export interface ResolvedDelivery {
  mode: "local-only" | "direct-PR" | "no-mistakes";
  autonomy: "attended" | "unattended";
  gates: Record<string, string | null>;
  defaultBranch: string;
  merge: "fast-forward" | "pr";
  yoloLocked: boolean;
}

interface Inputs {
  registry: Registry | null;
  shipFile: ShipFile | null;           // already schema-parsed; may carry junk keys we ignore
  repoId: { remote: string | null; path: string };
}

const SAFE = { mode: "local-only", autonomy: "attended" } as const;

export function resolveDelivery({ registry, shipFile, repoId }: Inputs): ResolvedDelivery {
  // Trusted half: registry only. Never read mode/autonomy from shipFile.
  const def = registry?.default ?? SAFE;
  const entry = registry?.projects.find((p) =>
    (p.match && repoId.remote && p.match === repoId.remote) ||
    (p.path && p.path === repoId.path));

  const mode = entry?.mode ?? def.mode;
  const autonomy = entry?.autonomy ?? def.autonomy;
  const yoloLocked = entry?.yolo === "locked" || registry?.yolo === "disabled";

  // Untrusted half: ship mechanics only.
  return {
    mode, autonomy, yoloLocked,
    gates: shipFile?.gates ?? {},
    defaultBranch: shipFile?.defaultBranch ?? "main",
    merge: shipFile?.merge ?? (mode === "direct-PR" ? "pr" : "fast-forward"),
  };
}
```

Also add an async `resolveDeliveryState(cwd: string): Promise<ResolvedDelivery>` that:
- reads `~/.pi/agent/projects.json` (parse via `parseRegistry`; missing/malformed → `null`, log a stderr warning, never throw),
- reads `<cwd>/.thanos/delivery.json` (parse via `parseShipFile`; missing/malformed → `null`),
- computes `repoId.remote` via `git -C cwd remote get-url origin` (empty → null) and `repoId.path = resolve(cwd)`,
- returns `resolveDelivery(...)`.
Model the file-read + fail-safe on `src/policy/loader.ts`.

**Step 4: Verify** → `bunx vitest run tests/governance/delivery.test.ts` PASS. Add tests for path-match and for malformed-registry → safe default.

**Step 5: Commit**

```bash
git add src/governance/delivery.ts tests/governance/delivery.test.ts
git commit -m "feat(governance): resolve delivery mode with captain/repo trust-split"
```

---

### Task 5: Policy overlay for modes

**Files:**
- Create: `src/governance/delivery-overlay.ts`
- Test: `tests/governance/delivery-overlay.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { deliveryPolicyOverlay } from "../../src/governance/delivery-overlay";

describe("deliveryPolicyOverlay", () => {
  it("local-only denies git push exec", () => {
    const rules = deliveryPolicyOverlay("local-only");
    const push = rules.find((r) => r.commandFamily === "git-push" || /push/.test(r.pattern ?? ""));
    expect(push?.decision).toBe("deny");
  });
  it("direct-PR and no-mistakes do not add a push-deny", () => {
    expect(deliveryPolicyOverlay("direct-PR").some((r) => r.decision === "deny")).toBe(false);
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** `src/governance/delivery-overlay.ts`:

```ts
import type { PolicyRule } from "../policy/types";

// Overlay rules are PREPENDED to the base policy so they take precedence,
// matching how src/agents/policy.ts narrowPolicyForAgent injects rules.
export function deliveryPolicyOverlay(mode: "local-only" | "direct-PR" | "no-mistakes"): PolicyRule[] {
  if (mode === "local-only") {
    return [{
      id: "delivery-local-only-no-push",
      capability: "exec",
      commandFamily: "git-push",   // confirm the family name used by src/audit/target.ts / classifier
      decision: "deny",
      reason: "local-only delivery mode: pushing to a remote is not allowed",
    }];
  }
  return [];
}

export function presetForMode(mode: string): "personal" | "team" | "ci" {
  return mode === "no-mistakes" ? "ci" : mode === "direct-PR" ? "team" : "personal";
}
```

> NOTE for implementer: verify how `commandFamily` is derived for `git push` (see `src/governance/tool-call.ts` and `src/audit/target.ts`). If there is no `git-push` family, match on `pattern` instead (e.g. a glob/regex the evaluator supports). Add a test that drives a real `git push` tool call through `evaluateGovernedToolCall` with the overlay applied and asserts `deny`.

**Step 4: Verify** → PASS.

**Step 5: Commit**

```bash
git add src/governance/delivery-overlay.ts tests/governance/delivery-overlay.test.ts
git commit -m "feat(governance): map delivery mode to policy overlay rules"
```

---

### Task 6: Wire delivery into register() (policy overlay + status + registry yolo lock)

**Files:**
- Modify: `src/index.ts`

**Steps (no new pure logic — integration; covered by Task 9 integration tests):**

1. After `policyStatePromise`, add:
   ```ts
   const deliveryStatePromise = resolveDeliveryState(process.cwd());
   ```
2. In `requirePolicy()` (or right where the policy is handed to the before-tool handler), apply the overlay:
   ```ts
   const delivery = await deliveryStatePromise;
   const overlay = deliveryPolicyOverlay(delivery.mode);
   const effective = { ...policy, rules: [...overlay, ...policy.rules] };
   ```
   Use `effective` wherever `policy` currently flows into governance/before-tool.
3. Registry-sourced yolo lock: after `deliveryStatePromise` resolves at startup, if `delivery.yoloLocked` → `permissions.lockYolo()`. (Env still wins via Task 2; both call the same idempotent lock.)
4. Status: in `session_start`, set `ctx.ui.setStatus("harness-delivery", theme.fg("accent", \`mode:${delivery.mode}${delivery.autonomy === "unattended" ? " ⚙ unattended" : ""}\`))`.
5. `bun run typecheck` → clean.

**Commit**

```bash
git add src/index.ts
git commit -m "feat: resolve delivery mode per session and overlay its policy ceiling"
```

---

### Task 7: Autonomy branch in before-tool.ts

**Files:**
- Modify: `src/hooks/before-tool.ts` (add `autonomy` param to `makeBeforeToolHandler`), and its call site in `src/index.ts`
- Test: `tests/hooks/autonomy.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { makeBeforeToolHandler } from "../../src/hooks/before-tool";

const noPrompt = async () => { throw new Error("should not prompt when unattended"); };

describe("before-tool autonomy", () => {
  it("unattended auto-approves an edit the ceiling permits, without prompting", async () => {
    const pm = { isYolo: false, yoloLocked: false, evaluate: () => "ask", remember: () => {} } as any;
    const spec = { activeSpec: undefined } as any;
    const handler = makeBeforeToolHandler(pm, spec, noPrompt, true, undefined, undefined, undefined, undefined, "unattended");
    const res = await handler({ toolName: "edit", input: { path: "src/x.ts" } });
    expect(res).toBeUndefined(); // allowed, no block
  });

  it("attended still prompts (unchanged behavior)", async () => {
    let prompted = false;
    const prompt = async () => { prompted = true; return true; };
    const pm = { isYolo: false, yoloLocked: false, evaluate: () => "ask", remember: () => {} } as any;
    const handler = makeBeforeToolHandler(pm, { activeSpec: undefined } as any, prompt, true, undefined, undefined, undefined, undefined, "attended");
    await handler({ toolName: "edit", input: { path: "src/x.ts" } });
    expect(prompted).toBe(true);
  });
});
```

**Step 2: Run → FAIL** (arg count / prompts when it shouldn't).

**Step 3: Implement**

- Add a trailing param to `makeBeforeToolHandler`: `autonomy: "attended" | "unattended" = "attended"`.
- Insert the branch **after** the policy `deny` check (`policyDecision?.decision === "deny"` → block) and **before** the "Low-risk: always allow" / prompt logic — i.e. right after the `if (policyDecision?.decision === "ask")` recordAudit line:

```ts
    // ── Unattended autonomy: trust the ceiling, skip interactive prompts ──
    // deny (above) still blocks; this only replaces the human prompt with allow.
    if (autonomy === "unattended") {
      const decision = permissions.evaluate(capability, target);
      if (decision === "deny") {
        await recordAudit("deny");
        return { block: true, reason: `${toolName} denied (capability: ${capability})` };
      }
      await recordAudit("allow", "autonomy:unattended");
      return;
    }
```

- Update the call site in `src/index.ts` to pass `(await deliveryStatePromise).autonomy`.

**Step 4: Verify** → `bunx vitest run tests/hooks/autonomy.test.ts` and `bunx vitest run tests/hooks` PASS. `bun run typecheck` clean.

**Step 5: Commit**

```bash
git add src/hooks/before-tool.ts src/index.ts tests/hooks/autonomy.test.ts
git commit -m "feat(hooks): unattended autonomy auto-approves within the policy ceiling"
```

---

### Task 8: build.md gates instruction + /ship command

**Files:**
- Modify: `agent/agents/build.md` (add gates instruction)
- Modify: `src/index.ts` or `src/commands/slash.ts` (register `/ship`)
- Create helper: `src/governance/ff-merge.ts`
- Test: `tests/governance/ff-merge.test.ts`

**Step 1 (build.md):** add a bullet under build's process:
> If `.thanos/delivery.json` exists in the worktree, its `gates` are the definition of done — run each gate command, and only report `status: success` if all required gates pass; put any failure in `findings`.

**Step 2 (ff-merge TDD):** write `tests/governance/ff-merge.test.ts` that, in a temp git repo, asserts `fastForwardMerge(repo, branch, defaultBranch)`:
- succeeds and advances the default branch when FF is possible,
- throws/returns a typed `{ ok: false, reason }` when the merge would not be a fast-forward (refuses).

**Step 3:** implement `src/governance/ff-merge.ts` using `git merge --ff-only` via `execFile` (model on `src/agents/worktree.ts`'s `execFileAsync`).

**Step 4:** register `/ship`:
- resolve `deliveryStatePromise`; only act for `mode === "local-only"`;
- require gate evidence (for v1: confirm with the user that gates are green, or re-run the resolved gates and abort on failure);
- call `fastForwardMerge`; report result. For `direct-PR`/`no-mistakes`, notify that Thanos does not push in v1 and hand back the branch/PR step.

**Step 5: Verify + Commit**

```bash
bunx vitest run tests/governance/ff-merge.test.ts   # PASS
bun run typecheck
git add agent/agents/build.md src/governance/ff-merge.ts src/index.ts tests/governance/ff-merge.test.ts
git commit -m "feat: build gates contract + /ship fast-forward merge for local-only"
```

---

### Task 9: Adversarial + regression tests

**Files:**
- Create: `tests/security/delivery-trust-split.test.ts`
- Create: `tests/governance/delivery-regression.test.ts`

**Adversarial (security):**
- A ship file declaring `mode: "no-mistakes"`, `autonomy: "unattended"`, `yolo: "inherit"` resolves to the registry/default values — **zero** effect on the trusted half (reuse Task 4 assertions at the `resolveDeliveryState` level with a fixture repo).
- With `permissions.lockYolo()`, the `/yolo` handler path refuses (unit: assert handler returns early / notify called; or assert `isYolo` stays false after attempting enable).

**Regression:**
- With no registry, no ship file, global yolo off, `autonomy` defaulting to `attended`: the before-tool handler behaves identically to today for a representative edit/bash call (prompt on high/critical, deny on deny, allow on low). Snapshot the decisions to lock the "pure additive default" guarantee.

**Verify full suite + commit**

```bash
bun run ci    # typecheck + lint + test, must be green
git add tests/security/delivery-trust-split.test.ts tests/governance/delivery-regression.test.ts
git commit -m "test: delivery trust-split adversarial + additive-default regression"
```

---

### Task 10: Docs + gitignore + example registry

**Files:**
- Modify: `.gitignore` (add `agent/projects.json`)
- Create: `agent/projects.example.json` (sample registry, like `models.example.json`)
- Modify: `README.md` (short "Delivery modes" + "Yolo lockout" section)

**Steps:** add the ignore line; write the example registry mirroring Section 3; document the three modes, the trust-split, `THANOS_YOLO_DISABLED=1`, and `/ship`. Then:

```bash
bun run ci
git add .gitignore agent/projects.example.json README.md
git commit -m "docs: document delivery modes, trust-split, and yolo lockout"
```

---

## Final verification

- `bun run ci` green.
- Manual smoke (optional): create `~/.pi/agent/projects.json` marking this repo `no-mistakes`/`attended`; launch `thanos`; confirm status shows `mode:no-mistakes`; confirm `THANOS_YOLO_DISABLED=1 thanos` refuses `/yolo`.
- Then use superpowers:finishing-a-development-branch to merge/PR.
