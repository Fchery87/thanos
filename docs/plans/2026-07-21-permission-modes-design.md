# Design: replace delivery modes with a single permission mode

**Status:** proposed · **Date:** 2026-07-21 · **Supersedes (if accepted):** the
delivery-mode + autonomy + gated-yolo control surface introduced in
[2026-06-23-thanos-delivery-modes-plan.md](2026-06-23-thanos-delivery-modes-plan.md).

## 1. Motivation

Thanos currently governs a session with **three overlapping controls**:

- **delivery mode** — `local-only` / `direct-PR` / `no-mistakes`
- **autonomy** — `attended` / `unattended`
- **yolo** — a session bypass (now toggleable in every mode, gated only by the lock)

Every other agent harness in this space uses **one** control surface instead:

| Harness | Model | Bypass |
|---------|-------|--------|
| Claude Code | permission modes: `default` / `acceptEdits` / `plan` / `bypassPermissions` | `bypassPermissions` |
| Codex | sandbox × approval policy | `--dangerously-bypass-approvals-and-sandbox` |
| OpenCode | per-tool `allow`/`ask`/`deny` + `--auto` | `--auto` (still respects `deny`) |

The owner prefers this single-axis model. Crucially, a "delivery mode" secretly
bundles **three separable concerns**, and only one is a permission concern:

| Bundled in delivery mode | Permission concern? | New home |
|--------------------------|---------------------|----------|
| Policy-preset ceiling (`personal`/`team`/`ci`) | **yes** — the real "how strict" knob | per-project `preset` (registry) |
| local-only egress + push guards | no — a *protection* | per-project `egress` flag (registry) |
| `/ship` + merge mechanics | no — delivery plumbing | ship file, unchanged |

Because `GovernanceRuntime.authorize` already reasons in **risk tiers**,
**capabilities**, **policy denies**, and a **permission manager** — not in
delivery-mode names — a single permission mode is a front-end swap over the same
engine, not a rewrite.

## 2. Goals / non-goals

**Goals**
- One session-level control the user toggles: `permissionMode`.
- Retire `autonomy` and gated-`yolo` as separate axes (fold them in).
- Preserve the entire protection floor (§6) — "swap the control surface, not the
  engine."
- A clean registry migration so existing config keeps working.

**Non-goals**
- Changing the enforcement engine's primitives (risk tiers, capabilities,
  policy evaluator, `PermissionManager`).
- Reworking `/ship`, gates, subagent roles, the spec lifecycle, or the harness
  evolution ledger.
- Per-tool allow/ask/deny UI (OpenCode style). Policy files already cover that.

## 3. The model

A single session value, **`permissionMode`**, with four stops (mirroring Claude
Code). It is *orthogonal to the policy ceiling*: the preset decides what is
**denied at all**; the mode decides **how much to prompt** for the rest.

| Mode | `read` (low) | `edit` (high) | `bash`/`exec` (critical) | unrecognized (MCP) | Headless (no UI) |
|------|:---:|:---:|:---:|:---:|:---:|
| `plan` | allow | **deny** | **deny** | deny | unchanged (nothing to prompt) |
| `default` | allow | ask | ask | ask | deny (cannot prompt) |
| `acceptEdits` | allow | **auto** | ask | ask | edit auto; exec/MCP deny |
| `bypass` | allow | auto | auto | auto | auto |

- **`plan`** — read-only exploration. Hard-denies `edit`/`exec`/`task`; `read`
  and `interaction` (`ask`/`todo`) stay allowed. Same shape as a read-only
  subagent role today.
- **`default`** — today's `attended`. Prompt on high/critical.
- **`acceptEdits`** — auto-approve the `edit` capability; still prompt for
  `bash`/`exec` and unrecognized tools.
- **`bypass`** — today's hardened yolo: skip prompts and risk gating, **but never
  a deny** (policy, permission-manager, egress, spec scope), still run the
  pre-critical snapshot and Lens secret scan. This *is* the modern "unattended"
  (see §5).

In **every** mode, the immutable floor in §6 runs first. `bypass` and `auto`
approvals never cross a deny — the invariant already implemented in
`ae3971e`/`e0f114e`.

## 4. What happens to the three bundled concerns

**Policy preset (ceiling).** Kept, but named directly. The registry stores a
per-project `preset: personal | team | ci` (replacing `mode`). `presetForMode`
already maps `local-only→personal`, `direct-PR→team`, `no-mistakes→ci`, so the
migration is mechanical. The preset still supplies the sensitive-read denies,
audit toggle, and headless default — unchanged.

**local-only egress / push guards.** Promoted to a standalone, mode-independent
per-project protection: `egress: "deny-remote"`. When set, the egress check and
the argv push guard fire exactly as they do today for `local-only` — but now
independent of which permission mode is active, and enforced ahead of the mode
switch (immutable). Default: off. This is the honest decomposition: preventing
remote egress is a *sandbox* concern (cf. Codex's separate sandbox axis), not an
approval concern.

**`/ship` + merge.** Decoupled from mode entirely. `/ship` reads the ship file
(`gates` / `defaultBranch` / `merge`) and performs the declared merge
(`fast-forward` or `pr`). The "never push" guarantee is provided by the `egress`
flag (if set), not by `/ship`. Result: `/ship` no longer needs a delivery mode
at all.

## 5. Reconciling autonomy and yolo (the coexistence decision)

The one behavior that does not map 1:1 is `unattended` — "auto-approve every
recognized tool within the ceiling, no prompts, for headless runs." Two options:

- **(A · chosen) `bypass` is the modern unattended.** Since `bypass` was hardened
  to respect every deny, run snapshots, and scan secrets, it already delivers
  "auto-approve within the ceiling" — it simply also allows unrecognized tools.
  A project that wants autonomous headless runs pins `defaultMode: bypass`. No
  fifth mode.
- **(B · rejected) add a fifth `auto` mode** = bypass-but-recognized-tools-only.
  Rejected as YAGNI: the only delta from `bypass` is auto-allowing unrecognized
  MCP tools, which an explicit policy `allow` rule already handles precisely and
  auditable-y. A fifth stop muddies the "four stops like Claude Code" model the
  owner asked for.

**The trap to avoid:** do **not** ship `permissionMode` *alongside* `autonomy`
and `yolo`. Three overlapping controls is where permission gaps breed. This
design *replaces* them: `bypass` subsumes yolo; `default`/`acceptEdits`/`plan`
subsume attended; `bypass` (or a pinned `defaultMode`) subsumes unattended.

## 6. Protection floor — the "without affecting my system" guarantee

Unchanged and enforced ahead of the mode switch in `authorize()`:

1. **Explicit policy denies** — preset rules + user `harness.policy.json`.
2. **Sensitive-read denies** — `.env*`, `**/*.pem`, `**/*.key`, `id_rsa*`,
   `id_ed25519*` (in `team`/`ci` presets).
3. **Egress / push guards** — now gated by the `egress` flag instead of
   `mode === "local-only"`, otherwise identical.
4. **Explicit-spec capability scope** — `GovernanceContext.specScope` (added in
   `e0f114e`).
5. **Lens Lite secret scan + read-before-modify** — runs regardless of mode.
6. **Pre-critical rollback snapshot** — runs for critical ops, including under
   `bypass`.
7. **Bypass lock** — the yolo lock, renamed: `THANOS_YOLO_DISABLED` (kept as an
   alias) / registry `bypass: "disabled"` / project `bypass: "locked"` forbids
   entering `bypass` mode.

None of these are touched by the front-end swap.

## 7. Registry schema + migration

```jsonc
// ~/.pi/agent/projects.json (trusted; captain-owned)
{
  "version": 2,
  "default": { "preset": "personal", "mode": "default" },
  "projects": [
    { "match": "git@github.com:acme/payments.git",
      "preset": "ci", "mode": "default", "egress": "deny-remote", "bypass": "locked" },
    { "path": "/home/you/code/site", "preset": "team", "mode": "acceptEdits" }
  ]
}
```

- `preset` (was `mode`), `mode` = default `permissionMode`, `egress` (optional),
  `bypass` (was `yolo`: `locked`/`disabled`).
- **Trust-split preserved:** `preset` / `mode` / `egress` / `bypass` are
  registry-only; the committed ship file still supplies only
  `gates`/`defaultBranch`/`merge`.
- **Migration (`version: 1 → 2`, on load):** `mode local-only → preset personal
  + egress deny-remote`; `direct-PR → team`; `no-mistakes → ci`; `autonomy
  unattended → mode bypass`, `attended → mode default`; `yolo → bypass`. Write
  the upgraded file back once (atomic write-then-rename, as today). A `v1`
  registry that fails the new schema still fail-safes to null → safe default.

## 8. Enforcement changes in `authorize()`

`GovernanceContext`:

```diff
- autonomy: DeliveryAutonomy;      // attended | unattended
- yolo: boolean;
- deliveryMode: DeliveryMode | undefined;
+ permissionMode: PermissionMode;  // plan | default | acceptEdits | bypass
+ egressGuard: boolean;            // was: deliveryMode === "local-only"
```

Decision order (immutable floor first, unchanged from §6):

```
egress guard (if egressGuard)        → deny            // was local-only
push guard  (if egressGuard)         → deny
policy deny                          → deny
explicit-spec scope                  → deny
── permission-mode switch ──
plan:        edit/exec/task          → deny; read/interaction → allow
bypass:      permission-deny?        → deny; else allow (+snapshot on critical)
acceptEdits: capability === edit     → allow
default:     (fall through to the existing risk/permission/prompt ladder)
── existing ladder (low-risk allow → MCP escape → permission eval → prompt) ──
```

`plan` maps onto the existing role-narrowing overlay machinery (read-only roles
already produce hard `edit`/`exec` denies), so it can reuse `roleNarrowingOverlay`
rather than new code. `bypass` is the branch shipped in `ae3971e`. `acceptEdits`
is a small new branch. `default` is the current attended ladder. The
`autonomy === "unattended"` auto-allow branch is deleted (folded into `bypass`).

## 9. UX

- **Status line:** show the mode — e.g. `⏸ plan` · `default` · `✎ accept-edits`
  · `⚡ bypass` (reuse the existing yolo status slot).
- **Cycle key:** one shortcut cycles `plan → default → acceptEdits → bypass`
  (Claude Code uses shift+tab; Thanos can reuse `Ctrl+Shift+Y` or add
  `Ctrl+Shift+M`). Entering `bypass` keeps the existing one-time confirmation and
  respects the lock.
- **Commands:**
  - `/mode [plan|default|acceptEdits|bypass]` — show or set.
  - `/yolo` → **deprecated alias** for `/mode bypass` (kept for muscle memory).
  - `/delivery` → **repurposed** to configure the per-project **preset + egress +
    bypass-lock** (the registry half), since "delivery mode" as a concept is
    gone. Or rename to `/project`.
- **First-launch selector:** picks the project `preset` (and offers `egress`),
  not a delivery mode. The session `mode` defaults from the registry `default.mode`.

## 10. Subagents / headless

- Subagents inherit a resolved `permissionMode` instead of `autonomy`. Read-only
  roles are already `plan`-equivalent via role narrowing; writer roles run
  `default`/`bypass` per the resolved project config.
- Headless degradation is explicit per §3: `default`/`acceptEdits` deny what they
  would prompt for; `bypass` proceeds. This preserves today's "unregistered repo
  fails closed" property (a headless `default` denies writes), verified by
  `tests/index.subagent-delivery.test.ts`.

## 11. Phasing, rollout, testing

1. **Types + resolver** — `PermissionMode`, registry v2 schema + `v1→v2`
   migration, `resolvePermissionState` (replacing `resolveDelivery`), keeping the
   pure/IO split and fail-safe defaults.
2. **Engine** — swap `authorize()`'s `autonomy`/`yolo`/`deliveryMode` for
   `permissionMode`/`egressGuard`; add the `plan`/`acceptEdits` branches; delete
   the unattended branch.
3. **UX** — status line, cycle key, `/mode`, deprecate `/yolo`, repurpose
   `/delivery`, first-launch selector.
4. **`/ship` decouple** — read the ship file directly.
5. **Docs + tests** — rewrite the governance.md "Delivery modes" section;
   migrate/extend the `authorize()` tests (the shared `tests/helpers/authorize.ts`
   already drives the live gate). Add a registry-migration test and one test per
   mode's decision row.

Ship behind nothing — it is a replacement, done on one branch with the migration,
not an incremental bolt-on (per the §5 trap).

## 12. Alternatives considered

- **Two dials (Codex-style sandbox × approval).** More expressive, but two things
  to reason about; the owner asked for the single-axis Claude Code model. The
  egress flag captures the useful part of the sandbox axis without a second dial.
- **Keep delivery modes, only ungate yolo (#4, already shipped).** Removes the
  immediate friction but keeps the three-axis mental model. This doc is the
  deliberate follow-up.
- **Fifth `auto` mode.** Rejected in §5.

## 13. Open questions

1. **Cycle-key binding** — reuse `Ctrl+Shift+Y`, or a new `Ctrl+Shift+M`?
2. **`/delivery` fate** — repurpose to project config, or rename to `/project`?
3. **`plan` and `task`** — does `plan` allow spawning read-only subagents, or
   deny `task` outright? (Leaning: allow read-only children only.)
4. **`acceptEdits` + new-file creation** — treat `write` (new file) the same as
   `edit`? (Leaning: yes — both are the `edit` capability today.)
5. **Registry `version` bump** — migrate in place on load (proposed), or ship a
   `/migrate` command the user runs once?
