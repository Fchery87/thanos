# Thanos Per-Project Delivery Modes + Yolo Lockout — Design

**Date:** 2026-06-23
**Status:** Design validated, not yet implemented
**Origin:** Phase 1 of the Pi+Thanos strengthening roadmap, inspired by firstmate's
per-project delivery modes (`no-mistakes`/`direct-PR`/`local-only`/`+yolo`), adapted
to Thanos's governance model rather than copied.

## Context

Thanos's policy layer is preset-based (`personal`/`team`/`ci`), capability rules
evaluated per tool-call in `pi.on("tool_call")` → `before-tool.ts`, all **session-global**.
The live subagent engine is **pi-subagents** (the legacy `src/agents/*` `task` tool is
dormant behind `THANOS_LEGACY_TASK=1`; do not extend it). firstmate's value is at the
**orchestration layer above** the engine, not inside it. This design adds a per-project
*delivery mode* that bundles a **policy ceiling + ship contract + autonomy**, and hardens
the existing global yolo into a lockable switch.

## Core decisions

1. **Unified mode** — one named per-project mode resolves to a policy ceiling AND a ship
   contract AND an autonomy level.
2. **Trust-split** — autonomy + policy ceiling are **captain-owned** (central private
   registry, never repo-committed; repo-declared autonomy is a privilege-escalation
   vector). Ship mechanics (gate commands, default branch, merge style) **may** be read
   from a committed per-project file because they cannot escalate privilege.
3. **Precedence:** session override (capped by registry; loosening needs confirm) →
   captain registry (trusted) → committed file (ship mechanics only) → safe default
   (`local-only`/`attended`). Resolution is **fail-safe**: missing/malformed → safe default,
   never more permissive.
4. **Yolo reconciled, not collided** — the existing global yolo is a session master
   kill-switch (bypasses all permission + policy checks). The new per-project autonomy is
   categorically weaker (flip `ask→allow` *within* the ceiling). Renamed to
   `autonomy: attended | unattended`; `+yolo` dropped from the mode vocabulary.
5. **Yolo hard-lockout** — config can disable yolo completely for a session: `setYolo(true)`
   becomes a no-op, `/yolo` + Ctrl+Shift+Y refuse, status hidden. `unattended` can never
   reintroduce a global bypass.

## Section 1 — Mode catalog

| Mode | Policy preset | Gates before landing | How it lands | Default autonomy |
|---|---|---|---|---|
| **local-only** (safe default) | `personal` + deny push/remote-exec | full: typecheck+lint+test | Thanos offers approved fast-forward merge to local default branch; never pushes | attended |
| **direct-PR** | `team` | advisory (run, report, don't block) | pushes branch, opens PR; human reviews | attended |
| **no-mistakes** | `ci` | full pipeline MUST pass (typecheck+lint+test+build) | PR or approved merge, only after green | attended |
| (unknown repo) | falls back to **local-only** | — | — | attended |

`autonomy: unattended` is captain-registry-only, opt-in per repo. It **trusts the ceiling**:
auto-approves anything the delivery-mode policy ceiling already permits (incl. edit/write
and bash) with no interactive prompt. `deny` rules still block (local-only still can't
push); the yolo lockout and Lens secret-scanning are untouched. Safety = per-repo opt-in +
the ceiling, not per-tier prompting. (The earlier "high-risk still prompts" carve-out was
dropped: with edit/write=high and bash=critical in `risk.ts`, it made unattended inert.)
It never widens reach.

## Section 2 — Yolo hard-lockout

- Config: `yolo: "disabled"` in the captain config, plus env override
  `THANOS_YOLO_DISABLED=1` that wins (so locked CI/client sessions can't be loosened by
  editing a file).
- `PermissionManager` (`src/permissions/manager.ts`): add `_locked` + `lockYolo()` +
  `get yoloLocked()`. Locked ⇒ `setYolo(true)` no-op, `_yolo` forced false, `isYolo`
  always false. All existing call sites funnel through `isYolo`/`evaluate()`, so the lock
  is authoritative automatically.
- `src/index.ts`: at `register()` resolve lock config → `permissions.lockYolo()`. `/yolo`
  command and Ctrl+Shift+Y handler (`:1148`) refuse with a clear notify when locked. Never
  render `⚡ yolo`; optional quiet `🔒 checks on` segment.
- Drive lock via `register()` config, not by flipping the class-level `_yolo = true`
  default, so existing permission tests keep their meaning.
- Live finding: yolo currently defaults ON (`_yolo = true`) with no settings wiring to turn
  it off — contradicts the captain's stated preference; fixed by this lockout/default-off.

## Section 3 — Data model

**A. Captain registry (trusted)** — `~/.pi/agent/projects.json`, gitignored like
`models.json`:

```jsonc
{
  "version": 1,
  "default": { "mode": "local-only", "autonomy": "attended" },
  "projects": [
    {
      "match": "git@github.com:Fchery87/scanforge.git",
      "path": "/home/nochaserz/Documents/Coding Projects/scanforge",
      "mode": "no-mistakes",
      "autonomy": "unattended",
      "yolo": "locked"
    }
  ]
}
```

**B. Committed ship file (untrusted)** — `.thanos/delivery.json` in the repo, or a fenced
` ```thanos-delivery ` block in its `AGENTS.md`. Ship mechanics only:

```jsonc
{
  "version": 1,
  "gates": { "typecheck": "bun run typecheck", "lint": "bun run lint", "test": "bun run test", "build": null },
  "defaultBranch": "master",
  "merge": "fast-forward"
}
```

Identity: match on `git remote get-url origin` first, fall back to absolute path. Schemas
in TypeBox. Fail-safe. The committed file can tighten/describe gates but never raise
`mode`/`autonomy`. YAGNI: repo-level only in v1 (no monorepo subpath modes).

## Section 4 — Resolution + enforcement

- `register()`: `const deliveryStatePromise = resolveDeliveryState(process.cwd());`
- New `src/governance/delivery.ts` → `ResolvedDelivery { mode, autonomy, policyOverlay,
  gates, defaultBranch, merge }`.
- **Policy-ceiling half:** mode → preset + overlay `PolicyRule[]`, injected like
  `narrowPolicyForAgent` does. `requirePolicy()` returns `base ⊕ policyOverlay`. No new
  evaluation logic — overlay is just more rules. `local-only` overlay denies `git push` /
  remote-mutating exec.
- **Autonomy half:** one new branch in `before-tool.ts`, placed *after* the policy `deny`
  check and *before* the interactive-prompt branch (`decision === "ask" || tier high/
  critical`): if `autonomy === "unattended"` ⇒ auto-approve + `recordAudit("allow",
  "autonomy:unattended")` and return. `deny` (policy or permission) is checked first and
  still blocks. Lock and global-yolo short-circuits sit above this, untouched.
- **Ship half** is not a tool-gate — surfaced to parent + `build` via existing
  system-prompt injection region (`index.ts:1210`).
- Status: `harness-delivery` segment, e.g. `mode:no-mistakes ⚙ unattended`.

## Section 5 — Ship/gate contract

- Gates live in the repo; `build` runs in a worktree of that repo, so it reads
  `.thanos/delivery.json` directly — no child-prompt plumbing (pi-subagents owns child
  prompts).
- `build.md` gains: "If `.thanos/delivery.json` exists, its `gates` are the definition of
  done — run each; only report `status: success` if all required gates pass; put failures
  in `findings`." Rides the existing `result.ts` contract.
- Mode-driven strictness (parent-side): `no-mistakes` ⇒ red gate blocks "done", chain
  `reviewer` then re-`build`; `direct-PR` ⇒ advisory; `local-only` ⇒ green required before
  merge offered.
- `/ship` command reads resolved mode: `local-only` ⇒ verify gate evidence then
  **fast-forward-only** merge to local default branch (refuse non-FF; never push);
  `direct-PR`/`no-mistakes` ⇒ confirm gate state, hand off branch/PR step (auto-PR is a
  v1 YAGNI cut). FF merge is the only new git-mutating action, only on explicit `/ship`.

## Section 6 — Testing

- `tests/governance/delivery.test.ts` — resolution, precedence, trust-split, fail-safe;
  committed file cannot raise mode/autonomy (core security assertion).
- `tests/policy/` — mode→preset mapping; `local-only` denies push; overlay composition
  preserves deny precedence.
- `tests/hooks/` — autonomy branch: unattended auto-approves edit/write/bash that the
  ceiling permits (no prompt), policy `deny` still blocks, ordering vs yolo/lock preserved;
  attended is unchanged from today.
- `tests/permissions/` — lockout: `setYolo(true)` no-op + `isYolo` false when locked; env
  override wins; existing default tests still pass.
- `tests/security/` — adversarial: repo-committed autonomy/yolo ignored; `/yolo` refuses
  under lock.
- Regression guard: with no registry, no committed file, global yolo off → behavior
  identical to today (pure additive default).

## Out of scope (deferred)

- Phase 2 fleet shell (tmux-visible detached crew, event-driven zero-token watcher,
  multi-repo, restart reconciliation) — separate larger design.
- Auto-PR / auto-push, monorepo subpath modes.
```

