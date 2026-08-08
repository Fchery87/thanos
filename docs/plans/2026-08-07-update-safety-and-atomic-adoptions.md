# Update Safety and Atomic Adoptions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a `pi-subagents` update structurally unable to leave the harness unpatched, move to 0.42.1 with every patched behaviour proven, and adopt the two Atomic subagent capabilities the engine already supports but Thanos does not use.

**Architecture:** Scope A — stay on `pi-subagents` as a dependency (ADR 0024). ADR 0024's tripwire #2 is firing today against a miscalibrated counter; Task 1.0 fixes the counter and amends the ADR, and does not move the ceiling. Update safety is a wrapper around `pi update --extensions` plus a startup assertion, not a change to the patch mechanism. The two Atomic adoptions are configuration and one bounded loop, not new subsystems. Context preservation uses pi's `context` hook rather than overriding compaction, because `CompactionResult` requires owning summarization and the `context` hook gets the same guarantee for a fraction of the surface.

**Tech Stack:** TypeScript (strict), vitest (`bun run test` — never bare `bun test`), `git apply` patch artifacts, markdown frontmatter agent manifests, pi `ExtensionAPI` event hooks.

---

## Provenance

Every claim below was verified against the working tree at `/home/nochaserz/.pi` on 2026-08-07, against `@earendil-works/pi-coding-agent@0.80.6` and `pi-subagents@0.41.0` as installed. File:line references are load-bearing.

Verified facts this plan depends on:

1. `pi update --extensions` honours an explicit version in the settings spec — `package-manager.js:911` reads `entry.parsed.version ? entry.parsed.spec : \`${name}@latest\``. Your `agent/settings.json:20` pins `npm:pi-subagents@0.41.0`, so pi reinstalls 0.41.0, not latest.
2. A same-version reinstall does **not** wipe patched files. Probed in an isolated scratch dir: installed 0.41.0, appended a marker, reinstalled the same spec, marker survived. Bun no-ops when satisfied.
3. **0.42.1 is the current release.** The artifact is `scripts/patches/pi-subagents-0.41.0-evidence.patch` and `PINNED_VERSION = "0.41.0"` (`scripts/patch-pi-subagents.mjs:76`). The moment the pin moves, `git apply --check` fails (`:126`), `patch-drift.ts:194` returns `version-mismatch` and deliberately refuses to heal, and the harness runs unpatched.
4. `agent/settings.json` is gitignored (`.gitignore:8`). The pin is untracked local state on one machine. `agent/settings.example.json:20` does carry it, so a fresh install is pinned.
5. The patch script is invoked from **nowhere** automatically except the session-start self-heal in `src/welcome/patch-drift.ts`. No postinstall, no wrapper, no launch hook. Exhaustive grep across the repo.
6. All five markers are currently applied in the live install.
7. `pi-subagents` honours frontmatter `model:` and `fallbackModels:` — `src/agents/agents.ts:1522` (`parseFrontmatterList(frontmatter.fallbackModels)`) and `:1614` (`...(frontmatter.model !== undefined ? { model: frontmatter.model } : {})`).
8. No Thanos agent file declares `model:` or `fallbackModels:` — zero occurrences across all 14. Routing lives in `agent/settings.json` `savedAgentOverrides` and is inert (`modelOverridesEnabled: false`).
9. `scout` and `worker` declare no `turnBudget` — 12 of 14 agents do.
10. `pi-subagents/src/runs/shared/structured-output.ts:168` returns an error on schema-invalid output with **no retry**. Thanos's own gate (`src/delegation/evidence.ts`) produces reasons, and `src/workflows/runner.ts:64` turns a required node's `awaiting_evidence` into terminal workflow failure.
11. Thanos registers 12 pi hooks. `context`, `session_before_compact`, and `session_compact` are **not** among them.

12. Hooks are registered in `src/runtime/{session-start,before-agent-start,governance-hooks,model-events}.ts` and `src/workflows/session-control.ts` — **not** in `src/index.ts`. Patch drift is surfaced at `src/runtime/session-start.ts:185` and `src/runtime/commands/doctor.ts:242`.
13. `src/context/` already exists (230 lines: `broker.ts`, `envelope.ts`, `render.ts`) and provides `ContextEnvelope` with `origin`/`authority`/`scope`/`trusted`/`staleAfter` plus `assemblePrompt`. Phase 4b extends this; it does not build a parallel mechanism.
14. `src/runtime/prompt-assembly.ts:30-35` routes the base prompt, trusted instructions, skills directive, and roster into `systemPrompt` (never compacted). `:19` routes `memoriesBlock` and `goalDirective` into a transcript message (compactable). `SystemPromptInput` (`:1-9`) has no field for permission mode, spec criteria, or workflow stage — they are never injected at all.
15. `BeforeAgentStartDeps` (`src/runtime/before-agent-start.ts:55-63`) already carries `permissions: PermissionManager` and `spec: SpecEngine`. Phase 4a needs no new plumbing to reach them.

---

## Decision A — ADR 0024 tripwire #2 is already firing

`PATCH_MARKERS.length` is **5**; `HUNK_CEILING` is **4** (`scripts/patch-pi-subagents.mjs:330`). The guard `5 > 4` is true, so the tripwire message prints on every patch run **today**, before this plan changes anything.

This contradicts two things stated elsewhere: ADR 0024's own prose ("one hunk remains as of this ADR, the timeout-classification guard", `:43`), and every claim in the conversation that produced this plan that no tripwire had fired. Both were wrong.

The likeliest reading is a calibration error rather than genuine surface growth: three of the five markers (`delegation.ts`, `delegation-request.ts`, `delegation-adapters.ts`) are the *same* concern — the evidence envelope — spread across three files, and the ceiling was set to 4 in the previous effort without being checked against the 5 markers that already existed. Had it been checked, it would have fired on the first run.

**Resolved: recalibrate to concerns, keep the ceiling at 4, amend the ADR.** Implemented as Task 1.0, before the port.

The case that this is a calibration bug rather than a fired signal rests on three verified points, not on convenience:

1. **The script already rejected a lower-level count for this exact reason.** The comment at `:322-329` explains why raw `^@@ ` counting was discarded: it "counts every non-contiguous change region per file separately and does not track the ADR's actual intent." That argument applies one level up unchanged — file-level markers also fail to track intent when a single concern spans three files.
2. **ADR 0024's own prose counts concerns, not files.** `:41-43` says "one hunk remains as of this ADR, the timeout-classification guard." That is wrong on the number (three concerns remained, across five files) but unambiguous about the *unit*: it is not counting patched files.
3. **The surface has shrunk, not grown.** Two patches retired against upstream absorption — discovery scanning at 0.30.0, `tui/render.ts` at 0.31.0. A tripwire meant to detect growth firing on a shrinking surface is measuring the wrong thing.

Today's real count is **3 concerns of a ceiling of 4**: the evidence envelope (three files — `delegation.ts` types, `delegation-request.ts` acceptance validation, `delegation-adapters.ts` projection), the fanout guard, and the timeout classification.

**The ceiling does not move.** Raising 4 to 6 would be goalpost-moving; changing what is counted, to the unit the ADR always used, is a fix. One concern of headroom remains, so the alarm keeps its power. Task 1.0 also derives the concern list *from* `PATCH_MARKERS` — each marker declares which concern it belongs to — so two concerns cannot later be quietly relabelled as one to duck the ceiling.

Implemented as **Task 1.0**, the first task of Phase 1.

---

### One ordering change from the conversation that produced this plan

That discussion proposed doing the forward-port (Phase 1) before the wrapper (Phase 0). **This plan reverses that**, deliberately: building the wrapper first means the 0.42.1 port is *executed through it*, which both protects the port with automatic rollback and exercises the wrapper against a real version bump — a better test than any synthetic one. The port is the riskiest step in this plan; it should not be the unprotected one.

---

## Phase 0 — A failed patch rolls the update back instead of leaving you unpatched

**Worktree:** execute in one, per superpowers:using-git-worktrees. Branch off `master` (currently `40f0ebb`).

### Task 0.1: Pin the extension manifest exactly

**Files:**
- Modify: `agent/npm/package.json:8`

Not on the `pi update` path (fact 1), but it protects against a bare `bun install` in that tree resolving the caret forward.

**Step 1: Make the edit**

```diff
-    "pi-subagents": "^0.41.0",
+    "pi-subagents": "0.41.0",
```

**Step 2: Verify nothing moved**

Run: `grep -n pi-subagents agent/npm/package.json && bun pm ls --cwd agent/npm 2>/dev/null | grep pi-subagents`
Expected: spec reads `0.41.0`, installed version still `0.41.0`.

**Step 3: Commit**

Note `agent/npm/` is gitignored (`.gitignore:19`), so this file is **not** committed. Record the change in the Phase 0 commit message body instead, and add it to Task 0.2's assertion so it is enforced rather than remembered.

---

### Task 0.2: Warn at startup when the pi-subagents spec loses its version

**Files:**
- Create: `src/welcome/pin-assertion.ts`
- Create: `tests/welcome/pin-assertion.test.ts`
- Modify: `src/runtime/session-start.ts` (alongside `reapplyPatchesIfVersionMatches` at `:185`)
- Modify: `src/runtime/commands/doctor.ts` (alongside `formatPatchDriftWarning` at `:242`)

**Step 1: Write the failing test**

```ts
// tests/welcome/pin-assertion.test.ts
import { describe, expect, it } from "vitest";
import { findUnpinnedDelegationPackage, formatUnpinnedPinWarning } from "../../src/welcome/pin-assertion";

describe("pi-subagents pin assertion", () => {
  it("accepts an explicitly pinned spec", () => {
    expect(findUnpinnedDelegationPackage(["npm:pi-subagents@0.41.0", "npm:pi-web-access"])).toBeUndefined();
  });

  it("flags a spec with no version", () => {
    expect(findUnpinnedDelegationPackage(["npm:pi-subagents"])).toBe("npm:pi-subagents");
  });

  it("flags a range rather than an exact version", () => {
    expect(findUnpinnedDelegationPackage(["npm:pi-subagents@^0.41.0"])).toBe("npm:pi-subagents@^0.41.0");
  });

  it("ignores unrelated packages entirely", () => {
    expect(findUnpinnedDelegationPackage(["npm:pi-web-access", "npm:@npm-ken/pi-bar"])).toBeUndefined();
  });

  it("names the file to edit in the warning", () => {
    const warning = formatUnpinnedPinWarning("npm:pi-subagents");
    expect(warning).toContain("agent/settings.json");
    expect(warning).toContain("npm:pi-subagents@");
  });
});
```

**Step 2: Run it to confirm it fails**

Run: `bun run test tests/welcome/pin-assertion.test.ts`
Expected: FAIL — cannot resolve `../../src/welcome/pin-assertion`.

**Step 3: Implement**

```ts
// src/welcome/pin-assertion.ts
// pi resolves an update spec that carries no explicit version as `<name>@latest`
// (package-manager.js:911). pi-subagents is the one package whose version the
// patch artifact is cut against, so an unpinned spec silently walks it forward
// into a version no patch applies to. agent/settings.json is gitignored, so this
// pin is untracked local state and nothing else notices when it drifts.

const DELEGATION_PACKAGE = "pi-subagents";
const EXACT_VERSION = /@\d+\.\d+\.\d+$/;

/** Returns the offending spec, or undefined when the pin is exact. */
export function findUnpinnedDelegationPackage(packages: readonly unknown[]): string | undefined {
  for (const entry of packages) {
    const spec = typeof entry === "string" ? entry : undefined;
    if (spec === undefined) continue;
    if (!spec.startsWith(`npm:${DELEGATION_PACKAGE}`)) continue;
    // Guard against a longer name that merely shares the prefix.
    const tail = spec.slice(`npm:${DELEGATION_PACKAGE}`.length);
    if (tail !== "" && !tail.startsWith("@")) continue;
    if (EXACT_VERSION.test(spec)) return undefined;
    return spec;
  }
  return undefined;
}

export function formatUnpinnedPinWarning(spec: string): string {
  return (
    `pi-subagents is not pinned to an exact version (found "${spec}").\n` +
    `pi resolves this as @latest on the next \`pi update --extensions\`, and the ` +
    `patch artifact only applies to the pinned version.\n` +
    `Fix: set "npm:${DELEGATION_PACKAGE}@<version>" in agent/settings.json.`
  );
}
```

**Step 4: Run the tests**

Run: `bun run test tests/welcome/pin-assertion.test.ts`
Expected: PASS, 5/5.

**Step 5: Wire it into startup and doctor**

Mirror how patch drift is already surfaced — same channel, same tone. Read `packages` from the loaded settings; call `findUnpinnedDelegationPackage`; emit `formatUnpinnedPinWarning` when it returns a spec. Two call sites, matching the existing pattern: `src/runtime/session-start.ts` (`:185`, next to `reapplyPatchesIfVersionMatches`) and `src/runtime/commands/doctor.ts` (`:242`, next to `formatPatchDriftWarning`).

**Step 6: Commit**

```bash
git add src/welcome/pin-assertion.ts tests/welcome/pin-assertion.test.ts \
        src/runtime/session-start.ts src/runtime/commands/doctor.ts
git commit -m "feat(welcome): warn when the pi-subagents pin loses its exact version"
```

---

### Task 0.3: Add `thanos update` — patch, verify, or roll back

**Files:**
- Create: `scripts/thanos-update.mjs`
- Modify: `package.json` (`bin`)
- Create: `tests/scripts/update.test.ts`

The wrapper is the fix. Sequence: record installed version → run `pi update --extensions` → re-run the patch script → let its own verifiers decide → on any failure, reinstall the recorded version, re-patch, and report. The unpatched state becomes unreachable because reaching it triggers rollback.

`scripts/patch-pi-subagents.mjs` already exits non-zero on a `broken` verdict (`:346`) or any failed apply (`:365`), so the wrapper reads exit codes and does not re-implement verification.

**Step 1: Write the failing test**

Test the decision logic with the subprocess calls injected, exactly as `reapplyPatchesIfVersionMatches` does with `runPatchScript` (`src/welcome/patch-drift.ts`). Do not spawn a real `pi update` in tests.

```ts
// tests/scripts/update.test.ts
import { describe, expect, it } from "vitest";
import { planUpdate } from "../../scripts/thanos-update.mjs";

const ok = { code: 0 };
const fail = { code: 1 };

describe("thanos update", () => {
  it("keeps the new version when the patch script succeeds", async () => {
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => calls.length === 0 ? "0.41.0" : "0.42.1",
      runPiUpdate: async () => { calls.push("update"); return ok; },
      runPatchScript: async () => { calls.push("patch"); return ok; },
      reinstall: async (v) => { calls.push(`reinstall:${v}`); return ok; },
    });
    expect(result.status).toBe("updated");
    expect(calls).toEqual(["update", "patch"]);
  });

  it("rolls back to the recorded version when the patch script fails", async () => {
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => calls.length === 0 ? "0.41.0" : "0.42.1",
      runPiUpdate: async () => { calls.push("update"); return ok; },
      runPatchScript: async () => { calls.push("patch"); return fail; },
      reinstall: async (v) => { calls.push(`reinstall:${v}`); return ok; },
    });
    expect(result.status).toBe("rolled-back");
    expect(result.from).toBe("0.41.0");
    expect(calls).toEqual(["update", "patch", "reinstall:0.41.0", "patch"]);
  });

  it("reports a failed rollback as needing manual repair rather than claiming success", async () => {
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      runPiUpdate: async () => ok,
      runPatchScript: async () => fail,
      reinstall: async () => fail,
    });
    expect(result.status).toBe("broken");
  });

  it("does not roll back when pi update itself fails — nothing moved", async () => {
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      runPiUpdate: async () => { calls.push("update"); return fail; },
      runPatchScript: async () => { calls.push("patch"); return ok; },
      reinstall: async (v) => { calls.push(`reinstall:${v}`); return ok; },
    });
    expect(result.status).toBe("update-failed");
    expect(calls).toEqual(["update"]);
  });
});
```

**Step 2: Run it to confirm it fails**

Run: `bun run test tests/scripts/update.test.ts`
Expected: FAIL — cannot resolve `scripts/thanos-update.mjs`.

**Step 3: Implement the decision logic**

Export `planUpdate(deps)` as pure orchestration over injected effects, with a thin `main()` that supplies the real ones. Statuses: `updated` | `unchanged` | `update-failed` | `rolled-back` | `broken`.

Rules the tests pin down:
- `pi update` fails → return `update-failed` and touch nothing. Nothing moved, so there is nothing to roll back.
- patch succeeds → `updated`.
- patch fails → reinstall the recorded version, re-run the patch, return `rolled-back`.
- rollback's own patch fails → `broken`, non-zero exit, message naming the recorded version and the manual command.

Real effects: `runPiUpdate` spawns `pi update --extensions`; `reinstall(v)` spawns `bun install pi-subagents@<v> --cwd agent/npm --omit=peer` (the same argv shape pi uses, `package-manager.js:1462`); `runPatchScript` spawns `node scripts/patch-pi-subagents.mjs`; `readVersion` reads `agent/npm/node_modules/pi-subagents/package.json`.

**Step 4: Run the tests**

Run: `bun run test tests/scripts/update.test.ts`
Expected: PASS, 4/4.

**Step 5: Register the bin**

```diff
   "bin": {
     "thanos-install": "./scripts/npm-install.mjs",
-    "thanos": "./scripts/thanos-launch.mjs"
+    "thanos": "./scripts/thanos-launch.mjs",
+    "thanos-update": "./scripts/thanos-update.mjs"
   },
```

**Step 6: Full suite, then commit**

Run: `bun run typecheck && bun run test`
Expected: all green, previous total (893) plus the new tests.

```bash
git add scripts/thanos-update.mjs tests/scripts/update.test.ts package.json
git commit -m "feat(scripts): roll back a pi-subagents update whose patches fail to apply"
```

---

### Task 0.4: Correct the mechanism — `pi install`, not `pi update --extensions`

**Discovered during the real Task 1.2 live cutover, not anticipated when this plan was written.** `runPiUpdate` in Task 0.3 was built around `pi update --extensions`, on the assumption that editing `agent/settings.json`'s pin sets a target that `pi update` reconciles toward. Running the actual cutover against this machine's live install disproved that: `pi update --extensions`'s own `updateConfiguredSources` filters out any package where `parsed.pinned` is true — *"Pinned npm versions are fixed"*, verbatim from that function's own comment — **before** the package is ever considered for update, regardless of what version it's pinned to. Confirmed byte-identical between the repo's pinned `@earendil-works/pi-coding-agent@0.80.6` devDependency and the live `0.83.0` binary actually running on this machine, so this is not a version-skew artifact — it is what `pi update --extensions` has always done for an exact-pinned package, by design.

This is not a bug in what Task 0.3 shipped — the wrapper correctly reflects what `pi update --extensions` does. But since `pi-subagents` is *deliberately* always exact-pinned (the entire point of Task 0.1/0.2), `runPiUpdate` can never perform the one operation this whole plan exists for: moving the pin forward on purpose.

The correct mechanism, verified by tracing `PackageManager.install()` → `installNpm()` → a direct `bun install <spec>` with no pinned-skip check, and by running it for real: `pi install npm:pi-subagents@<version>`. `addSourceToSettings` matches the existing `agent/settings.json` entry by package identity (not full spec string) and replaces it in place — confirmed no duplicate entries result. One further empirical finding from the same live run: `pi install` writes a caret range into `agent/npm/package.json` (`"^0.42.1"`) even though a raw `bun install <pkg>@<version>` reliably writes exact — traced but not root-caused (reproducing it in isolated scratch directories with identical argv did not reproduce the caret; something about the real environment differs). The fix does not depend on understanding why — it defensively re-asserts the exact pin after every install, forward or rollback, rather than trusting either tool's default.

**Files:**
- Modify: `scripts/thanos-update.mjs`
- Modify: `tests/scripts/update.test.ts`

**Step 1: Redesign the effect shape**

Replace `runPiUpdate` and `reinstall` with a single `installPinned(version)` effect, used for both the forward path and the rollback path — this is what keeps `agent/settings.json`'s pin and the actual installed version from ever drifting apart at any step, including mid-rollback. Add `readPinnedTarget()`, reading the exact version currently declared for `pi-subagents` in `agent/settings.json`'s `packages` array (mirror the parsing already established in `src/welcome/pin-assertion.ts`, adapted for `.mjs` — do not attempt a cross-module-type import from a plain script).

```
readVersion: () => Promise<string>            // currently installed
readPinnedTarget: () => Promise<string>        // currently pinned in agent/settings.json
installPinned: (version: string) => Promise<{ code: number }>   // pi install + defensive exact re-pin
runPatchScript: () => Promise<{ code: number }>
```

**Step 2: Redesign the decision logic**

- Read `before` (installed) and `target` (pinned). If they differ, call `installPinned(target)`. If that fails, return `install-failed` — nothing was touched beyond `installPinned`'s own attempt, so there is nothing to roll back.
- Run the patch script regardless (this is also the self-heal path when `before === target` but patches drifted).
- Patch succeeds: `updated` (version moved) or `unchanged` (it didn't).
- Patch fails: call `installPinned(before)` to restore both the previous version and the previous pin together. If that fails, `broken`. If it succeeds, re-run the patch script; if that fails too, `broken`; otherwise `rolled-back`.

**Step 3: Tests**

Full TDD via injected deps, no real subprocess spawning — same discipline as Task 0.3. Cover: version differs, install succeeds, patch succeeds → `updated`; install fails → `install-failed`, `installPinned` called once, nothing else; install succeeds, patch fails, rollback's `installPinned` and re-patch both succeed → `rolled-back`, and confirm `installPinned` was called with `before` on rollback (proving the pin, not just the binary, gets restored); rollback's `installPinned` fails → `broken`; rollback's `installPinned` succeeds but the re-patch fails → `broken` (same "don't trust reinstall alone" property Task 0.3's own fix established); version already matches target → `installPinned` is never called, only the patch script runs.

**Step 4: Real wiring**

`installPinnedReal(version)`: spawn `pi install npm:pi-subagents@${version}`, then unconditionally rewrite `agent/npm/package.json`'s `pi-subagents` entry to the bare exact version string (no caret), regardless of what `pi install` wrote. `readPinnedTargetReal()`: parse `agent/settings.json`'s `packages` array for the `pi-subagents` entry's version.

**Step 5: Verification**

`bun run typecheck && bun run test`, full suite green. **Do not exercise the real wiring against the live install again** — Task 1.2's manual walkthrough already validated the underlying `pi install` → re-pin → patch → verify sequence works correctly for real; re-running it here would touch live state for no new information the decision-logic tests don't already cover.

**Step 6: Commit**

```bash
git add scripts/thanos-update.mjs tests/scripts/update.test.ts
git commit -m "fix(scripts): use pi install instead of pi update --extensions for pinned packages"
```

---

## Phase 1 — The ceiling counts concerns, then pi-subagents runs 0.42.1 with every patched behaviour proven

Executed **through** the Phase 0 wrapper, so a failed port rolls itself back.

### Task 1.0: Count concerns, not patched files, and correct the ADR

Resolves Decision A. Rationale is recorded there; this is the implementation.

**Files:**
- Modify: `scripts/patch-pi-subagents.mjs` (`PATCH_MARKERS`, `HUNK_CEILING` guard)
- Modify: `docs/adr/0024-pi-subagents-stays-a-dependency-until-these-tripwires-fire.md`
- Create: `tests/scripts/patch-concerns.test.ts`

**Step 1: Write the failing test**

Assert the derived concern count is 3, that the ceiling is unchanged at 4, that the tripwire does *not* fire at 3, and that it *does* fire at 5 — the last one proving the alarm still works rather than merely being silenced.

**Step 2: Run it, confirm it fails, then implement**

Add a fourth element to each `PATCH_MARKERS` entry naming its concern (`"evidence-envelope"`, `"fanout-guard"`, `"timeout-classification"`). Derive the count with `new Set(PATCH_MARKERS.map((m) => m[3])).size` and compare that against `HUNK_CEILING`. Keep the existing report-don't-fail behaviour and the `console.log`-not-`console.error` convention (`:331-338`).

**Step 3: Amend ADR 0024**

Correct `:41-43` — "one hunk remains" is factually wrong. State the real position: three concerns across five patched files, ceiling four, one concern of headroom. Record the counting rule and this recalibration in the ADR itself, with the date, so the next reader sees the decision rather than re-deriving it.

**Step 4: Verify the tripwire is quiet for the right reason**

Run: `node scripts/patch-pi-subagents.mjs`
Expected: no tripwire line, five markers applied, exit 0. Then temporarily add a fake fourth concern and confirm the tripwire fires; remove it.

**Step 5: Commit**

```bash
git add scripts/patch-pi-subagents.mjs tests/scripts/patch-concerns.test.ts \
        docs/adr/0024-pi-subagents-stays-a-dependency-until-these-tripwires-fire.md
git commit -m "fix(patch): count patched concerns against the ADR 0024 ceiling, not patched files"
```

### Task 1.1: Establish what 0.42.1 changed under the patch anchors

**Files:**
- Create: `research/pi-subagents-0.42.1-port.md`

**Step 1: Diff the anchors**

For each of the five `PATCH_MARKERS` targets (`scripts/patch-pi-subagents.mjs`), diff 0.41.0 against 0.42.1:

```bash
cd /tmp && npm pack pi-subagents@0.42.1 && tar xf pi-subagents-0.42.1.tgz
for f in src/api/delegation.ts src/slash/delegation-request.ts \
         src/slash/delegation-adapters.ts src/extension/fanout-child.ts \
         src/runs/shared/model-fallback.ts; do
  echo "=== $f ==="
  diff -u "/home/nochaserz/.pi/node_modules/pi-subagents/$f" "/tmp/package/$f" || true
done
```

**Step 2: Record the verdict per marker**

For each: *absorbed upstream* (retire the hunk), *still needed, anchor intact* (re-derive mechanically), or *still needed, anchor deleted* (re-derive from scratch). An anchor-deleted marker whose verifier reports `broken` rather than "candidate for retirement" is **ADR 0024 tripwire #1** — stop and record it before continuing.

**Step 3: Commit the research note**

```bash
git add research/pi-subagents-0.42.1-port.md
git commit -m "docs(research): record the 0.41.0 to 0.42.1 patch-anchor port matrix"
```

### Task 1.2: Cut and verify the 0.42.1 artifact

**Files:**
- Create: `scripts/patches/pi-subagents-0.42.1-evidence.patch`
- Delete: `scripts/patches/pi-subagents-0.41.0-evidence.patch`
- Modify: `scripts/patch-pi-subagents.mjs:76` (`PINNED_VERSION`)
- Modify: `package.json:30`, `agent/settings.json:20`, `agent/settings.example.json:20`, `agent/npm/package.json:8`
- Modify: `tests/delegation/timeout-classification.test.ts:8` (`PINNED`)
- Modify: `tests/delegation/compatibility.test.ts` (same constant)

**Step 1: Bump every declaration of the version together**

All six sites move at once. The hermetic tests assert the devDependency version matches `PINNED`, so a partial bump fails loudly — that is the intended guard.

**Step 2: Re-derive the artifact against 0.42.1**

Apply each still-needed hunk to a clean 0.42.1 tree and regenerate the patch. Keep the `thanos-patch:` marker comments verbatim — `PATCH_MARKERS` and `patch-drift.ts` both key off them.

**Step 3: Run the behaviour verifiers**

Run: `node scripts/patch-pi-subagents.mjs`
Expected: every verifier reports verified, including
`[thanos-patch] verified: subagent wall-clock timeout is not classified as a retryable model failure`
Exit code 0. A `broken` verdict exits 1 (`:346`) — that is a tripwire, not a retry prompt.

**Step 4: Confirm the hunk ceiling still holds**

`HUNK_CEILING = 4` against `PATCH_MARKERS.length` (`:330`). If the port needs a sixth concern, that is **ADR 0024 tripwire #2** — stop and record.

**Step 5: Full suite**

Run: `bun run typecheck && bun run test`
Expected: all green. The hermetic tests now build their scratch copy from 0.42.1.

**Step 6: Exercise the wrapper end to end**

Run: `node scripts/thanos-update.mjs`
Expected: `updated`, five markers applied. Then deliberately corrupt one hunk and re-run; expected `rolled-back` to the prior version with all five markers restored. Revert the corruption.

**Step 7: Commit**

```bash
git add scripts/patches/ scripts/patch-pi-subagents.mjs package.json \
        agent/settings.example.json tests/delegation/
git commit -m "feat(delegation): forward-port the evidence patch to pi-subagents 0.42.1"
```

---

## Phase 2 — Every agent declares its own model

### Task 2.1: Correct the stale profile count — and add no budgets

**Decision B, resolved: leave `scout` and `worker` without a `turnBudget`.** The only change here is a wrong number in a comment.

The item entered this plan as "12 of 14, not 14 of 14" — a gap to close. That framing was wrong twice over:

1. **It reverses a deliberate decision.** `tests/agents/roster-contract.test.ts:173-175` records it: *"turnBudget is optional — 2 of 13 profiles (scout, worker) never declared maxTurns and this task must not fabricate one for them (pi-subagents' own `resolveTurnBudgetConfig` treats 'no turn budget' as valid)."*
2. **Neither agent is actually unbounded.** Both declare `timeoutMs` — `scout` 600000 (10 min), `worker` 1200000 (20 min). They are wall-clock bounded; they simply are not *turn* bounded.

Point 2 is what settles it. The argument for bounding `worker` was "unbounded, and it grants `bash, edit, write`." The "unbounded" half is false. What remains is "mutating agents should also carry turn budgets," which is a preference, not a defect — and picking 40 over 25 with no observed failure to calibrate against is exactly the fabrication the prior decision refused. If a `worker` run ever burns its wall clock on a turn loop, that is a real signal and the budget can be set from it.

**Files:**
- Modify: `tests/agents/roster-contract.test.ts:173`

**Step 1: Fix the count**

The comment says "2 of 13 profiles"; there are **14** agent files — Phase 3 added `reviewer-patterns` and `reviewer-decisions` after that comment was written. The "2" is correct; the "13" is stale.

```diff
-      // turnBudget is optional — 2 of 13 profiles (scout, worker) never declared
+      // turnBudget is optional — 2 of 14 profiles (scout, worker) never declared
```

**Step 2: Confirm nothing else moved**

Run: `bun run test tests/agents/roster-contract.test.ts`
Expected: PASS, unchanged assertions.

**Step 3: Commit**

```bash
git add tests/agents/roster-contract.test.ts
git commit -m "docs(tests): correct the stale roster profile count in the turnBudget rationale"
```

### Task 2.2: Move model routing into agent frontmatter

**Files:**
- Modify: `src/agents/loader.ts`, `src/agents/manifest.ts`
- Modify: `tests/agents/loader.test.ts`, `tests/agents/manifest.test.ts`
- Modify: agent files receiving a model
- Modify: `agent/settings.json` (drain `savedAgentOverrides`)

pi-subagents already honours these keys (fact 7). This moves routing from an untracked, currently-inert settings blob into version-controlled files that a PR can review.

**Step 1: Write the failing validation tests**

`model` must be a non-empty string when present; `fallbackModels` a non-empty array of non-empty strings. Reject `""`, `[]`, `[""]`, and non-string members — the same posture `manifest.ts` already takes toward `timeoutMs` and `turnBudget`.

**Step 2: Run to confirm failure, then implement**

Mirror the existing validators in `manifest.ts` exactly, including error-message shape (`${role} must declare ...`).

**Step 3: Decide the routing table — DECISION POINT**

`savedAgentOverrides` currently holds exactly one entry: `evaluator → theclawbay/gpt-5.4-mini`. Migrate that one directly.

For the other 13, **omitting `model:` is the correct default and preserves today's behaviour exactly** (session default model). Do not invent a routing table — assigning models is a cost and capability judgement that belongs to the operator. Land the mechanism with `evaluator` migrated, and let models be added per agent as they are decided.

Operational note (not an ADR — no ADR covers this): any non-OpenAI model added later via TheClawbay needs a per-model `api: openai-completions` in `models.json`, or it 400s on `v1/responses`.

**Step 4: Drain the settings stash**

Remove the migrated entry from `savedAgentOverrides`. Leave `modelOverridesEnabled: false` — frontmatter is not governed by that flag, so routing now takes effect through the agent files.

**Step 5: Verify routing actually applies**

A green suite is not proof the runtime honours the key. Dispatch `evaluator` and confirm the child reports the expected model in its transcript header.

**Step 6: Commit**

```bash
git add src/agents/loader.ts src/agents/manifest.ts tests/agents/ agent/agents/
git commit -m "feat(agents): declare model routing in agent frontmatter instead of settings"
```

---

## Phase 3 — A schema-rejected result gets one chance to fix itself

### Task 3.1: Add a bounded repair loop at the evidence gate

**Files:**
- Modify: `src/delegation/runtime.ts`
- Modify: `tests/delegation/` (new `repair.test.ts`)

Thanos computes better rejection reasons than Atomic does and then shows them to the operator instead of to the child that could act on them (facts 10). Atomic retries three times; **cap at one** here — Thanos's gate rejects on governance grounds too (missing artifacts, absent acceptance), and those do not become true on a retry.

**Step 1: Write the failing tests**

- A first-attempt `awaiting_evidence` re-delegates exactly once with the reasons appended to the prompt.
- A second `awaiting_evidence` returns `awaiting_evidence` and does **not** delegate a third time.
- A `failed` outcome is **not** retried — only schema/evidence rejections are repairable.
- Both attempts appear in the acceptance ledger, so the repair is visible rather than hidden.

**Step 2: Run to confirm failure, then implement**

Add `maxRepairAttempts` (default 1) to `DelegationInput`. On `awaiting_evidence`, re-delegate once with a repair preamble carrying `outcome.reasons` verbatim. Preserve `requestId` lineage so the ledger shows two attempts of one delegation, not two delegations.

**Step 3: Confirm the workflow path benefits**

`src/workflows/runner.ts:64` needs no change — it sees the post-repair outcome.

**Step 4: Commit**

```bash
git add src/delegation/runtime.ts tests/delegation/repair.test.ts
git commit -m "feat(delegation): give a schema-rejected child one bounded repair attempt"
```

---

## Phase 4a — The model is told the invariants the harness enforces

### Correcting the premise this phase was originally written on

Earlier drafts of this plan, and the conversation that produced it, claimed Thanos's governed invariants pass through the compaction summarizer unprotected. **That was half wrong, and the correction reshapes the phase.**

`src/runtime/prompt-assembly.ts:30-35` puts the base prompt, trusted instructions, skills directive, and roster into `systemPrompt`. The system prompt is re-sent whole on every call and never enters the compactable transcript — **those were always safe.**

What is actually true, verified:

1. `prompt-assembly.ts:19` — `dynamicBlocks = [memoriesBlock, goalDirective]` — returns as a **transcript message** (`customType: "harness-context"`, `display: false`, `before-agent-start.ts:196`). So the goal directive *is* compactable. But `before_agent_start` re-injects it every user turn, so the exposure is a single agentic run that crosses a mid-run compaction, not permanent loss. Narrower than claimed. That is Phase 4b.
2. **Spec acceptance criteria, permission mode, and active workflow stage are never injected at all.** `SystemPromptInput` (`prompt-assembly.ts:1-9`) has seven fields and none of them is any of these. This is not a compaction problem; it is a coverage gap — the harness enforces three things the model is never told. That is Phase 4a, and it is the larger hole.

**Cache constraint — binding on any design here.** `before-agent-start.ts:180-182` records why the static/dynamic split exists: dynamic per-turn blocks live in an uncached tail message "so they don't bust the prompt cache every turn." Placement is therefore decided by volatility, not convenience. A design that puts volatile state into the cached prefix is wrong on cost even if it is right on content.

**No new plumbing is required.** `BeforeAgentStartDeps` (`before-agent-start.ts:55-63`) already carries `permissions: PermissionManager` and `spec: SpecEngine`. The state is at the call site and simply is not used for prompt assembly.

### Task 4a.1: Inject the permission mode as a static block

Permission mode is stable within a session, so it belongs in the cached prefix alongside the roster — no per-turn cache churn.

**Files:**
- Modify: `src/runtime/prompt-assembly.ts` (`SystemPromptInput`, static block list)
- Modify: `src/runtime/before-agent-start.ts` (pass it from the existing `permissions` dep)
- Modify: `tests/prompt-system/` (or wherever `assembleSystemPrompt` is currently covered)

**Step 1: Write the failing test**

- The rendered `systemPrompt` names the active permission mode.
- It appears in the **static** section — assert it is in `systemPrompt`, not `dynamicMessage`, so a later refactor cannot silently move it and start busting the cache.
- Subagents get no permission block (`isSubagent` returns early at `:26`).

**Step 2: Run to confirm failure, then implement**

Add `permissionMode?: string` to `SystemPromptInput` and append it to the `staticBlocks` array at `:30-35`. Keep it to one line — it is in the cached prefix, but the prefix is still paid on every call.

**Step 3: Run the tests, then commit**

```bash
git add src/runtime/prompt-assembly.ts src/runtime/before-agent-start.ts tests/prompt-system/
git commit -m "feat(prompts): tell the model which permission mode the harness is enforcing"
```

### Task 4a.2: Inject spec acceptance criteria and the active workflow stage as dynamic blocks

Both change during a session, so both belong in the uncached tail beside `goalDirective`.

**Files:**
- Modify: `src/runtime/prompt-assembly.ts` (`SystemPromptInput`, dynamic block list)
- Modify: `src/runtime/before-agent-start.ts` (from the existing `spec` dep; workflow stage from `src/workflows/state.ts`)
- Modify: the same test file as 4a.1

**Step 1: Write the failing tests**

- With an active spec, `dynamicMessage` contains its acceptance criteria.
- With an active workflow, `dynamicMessage` names the current stage (`Planning` … `AwaitingAcceptance`, `src/workflows/state.ts:39-74`).
- With neither active, `dynamicMessage` is unchanged — no empty scaffolding on ordinary chat, matching how `goalDirective` already behaves.
- Neither block reaches `systemPrompt`. This is the cache-constraint assertion; it must fail loudly if someone moves them.

**Step 2: Run to confirm failure, then implement**

Extend `dynamicBlocks` at `:19`. Preserve the existing subagent path at `:26-28`, which deliberately still forwards a directly-set goal directive as a tail message — the same reasoning applies to a directly-set spec.

**Step 3: Verify against a live session**

Set a spec, start a workflow, and confirm both appear in the model's context. A green suite does not prove the block is reaching the provider.

**Step 4: Full suite, then commit**

```bash
git add src/runtime/prompt-assembly.ts src/runtime/before-agent-start.ts tests/prompt-system/
git commit -m "feat(prompts): surface spec criteria and workflow stage to the model"
```

---

## Phase 4b — The dynamic block survives a mid-run compaction

**Lower value than 4a and safe to defer.** It closes a narrow window: `before_agent_start` fires once per *user turn*, so a compaction triggered mid-run (threshold or overflow) deletes the `harness-context` tail message and nothing restores it until the user speaks again. Everything 4a adds to the dynamic tail inherits the same exposure, which is why this follows 4a rather than preceding it.

### Task 4b.1: Re-assert the dynamic tail via the `context` hook

**Files:**
- Create: `src/context/invariants.ts`
- Create: `tests/context/invariants.test.ts`
- Modify: `src/runtime/session-start.ts` (register the `context` hook)

**Design note.** Overriding `session_before_compact` means returning a full `CompactionResult` (`{ summary, firstKeptEntryId, tokensBefore }`) — i.e. owning summarization. The `context` hook (`{ messages }` → `{ messages? }`, fires before every LLM call) gets the same mechanical guarantee for far less surface: compaction may delete the block, and the hook restores it before the next call. That is Atomic's `keepContext` guarantee without owning the compactor.

**Pattern-fit constraint.** `src/context/` already carries `envelope.ts` (`ContextEnvelope`: `origin`, `authority`, `scope`, `source`, `trusted`, `capturedAt`, `staleAfter`, `content`, `maxBytes`), `broker.ts` (`assemblePrompt`), and `render.ts` (`renderContextEnvelopeOrOmit`, which quotes and escapes content so it reads as data to the model). Express the restored block as a `ContextEnvelope` with `origin: "harness"`, `authority: "instruction"`, and render it through the existing renderer — not as a parallel marker-delimited string with its own escaping. Identify a stale block for replacement by envelope `id`, not by an ad-hoc HTML comment.

Honour the constraint documented in `envelope.ts`: these fields are descriptive metadata only and are never read by `GovernanceRuntime` as an authorization input. Restoring an invariant into context restates what governance already enforces; it must never become a path that widens capability.

**Step 1: Write the failing tests**

- Messages missing the block get exactly one appended.
- Messages already carrying it end with **exactly one** — stale copies are stripped by envelope `id` first (the hook fires on every call, so idempotence is load-bearing).
- With no goal, no spec, and no workflow active, the hook returns `undefined` and leaves messages untouched. Ordinary chat pays nothing.
- The restored content is byte-identical to what `assembleSystemPrompt` produced, so 4b cannot drift from 4a.

**Step 2: Run to confirm failure, then implement**

Reuse `assembleSystemPrompt`'s `dynamicMessage` as the single source of truth rather than rebuilding the block — a second construction path is exactly how the two would diverge.

**Step 3: Register the hook**

In `src/runtime/session-start.ts`. Return `{ messages }` only when the set changed; `undefined` otherwise.

**Step 4: Verify against real compaction**

Not unit tests alone: run a session with an active goal past the compaction threshold *within a single agentic run*, then confirm the block is present and verbatim on the following call.

**Step 5: Full suite, then commit**

```bash
git add src/context/invariants.ts tests/context/invariants.test.ts src/runtime/session-start.ts
git commit -m "feat(context): restore the harness context tail after a mid-run compaction"
```

---

## Sequencing and verification

| Phase | Outcome | Depends on |
|---|---|---|
| 0 | A failed patch rolls the update back | — |
| 1 | The ceiling counts concerns (1.0), then 0.42.1 with every patched behaviour proven | Phase 0 (executed through the wrapper) |
| 2 | Every agent declares its own model | independent |
| 3 | A schema-rejected child gets one repair attempt | independent |
| 4a | The model is told the invariants the harness enforces | independent |
| 4b | The dynamic block survives a mid-run compaction | Phase 4a |

Phases 2–4 are independent of each other and of 0–1; they can land in any order or in parallel worktrees. **Phase 1 must follow Phase 0** — that is the entire reason for the ordering reversal recorded above.

Gate for every phase: `bun run typecheck && bun run lint && bun run test` green, and for Phases 1–2 the live-dispatch check, because a green suite does not prove the runtime honours a key.

---

## What this plan deliberately does not do

- [ ] NOT raising `HUNK_CEILING`. Task 1.0 changes what is counted, never how many are allowed. If the concern count ever reaches 5, the tripwire fires and is honoured.
- [ ] NOT adding turn budgets to `scout` or `worker`. Both are wall-clock bounded; a turn budget with no observed failure behind it is invented policy.
- [ ] NOT vendoring pi-subagents, and NOT building a Thanos-owned subagent engine. The measured floor for owning the engine is ~45k lines against an 18k-line harness, and it relocates update exposure rather than removing it.
- [ ] NOT porting Atomic's `@bastani/workflows` DSL. Thanos's fixed state machine (`Planning → … → AwaitingAcceptance`) can enforce evidence per transition precisely because the topology is not author-defined; an arbitrary DAG gives that up.
- [ ] NOT replacing pi's compactor. Phase 4b restores the block after compaction rather than owning summarization.
- [ ] NOT moving spec criteria or workflow stage into the cached system-prompt prefix. Both are volatile; the split at `before-agent-start.ts:180-182` exists to keep volatile content out of the cache, and Task 4a.2 asserts they stay out.
- [ ] NOT pinning the other four packages (`context-mode`, `pi-web-access`, `@npm-ken/pi-bar`, `@victor-software-house/pi-curated-themes`). They resolve `@latest` on every update; none carries a patch artifact, so none can land in the unpatched state. Worth revisiting if one is ever implicated in a breakage.
- [ ] NOT touching `src/workflows/runtime.ts:74,430`'s pre-existing `timeoutMs: 120_000`, the verifiers' `skipped`-vs-`broken` conflation, or the four docs still describing the retired generic `reviewer`. All three remain open follow-ups from the previous effort and are unrelated to update safety.
