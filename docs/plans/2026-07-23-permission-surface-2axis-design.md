# Permission-surface mapping: today's 5 axes → a 2-axis target

> **STATUS: DESIGN-ONLY. This document changes no code.**
> It is Task 13 of `docs/plans/2026-07-23-thanos-codex-polish.md` — the last task in that
> plan, deliberately scoped to paper only. Every finding below is grounded by reading the
> actual implementation on `master` (plus the not-yet-merged `feat/launcher-sandbox` branch
> for Task 7's sandbox, cited explicitly where used). Building the actual 2-axis system —
> new types, a new resolver, a migration of `harness.policy.json` / `projects.json` — is
> **separate future work**, not started here. Where this doc makes a recommendation for
> that future plan, it is labeled as a recommendation, not a decision.

## 1. Why this doc exists

The original Codex-CLI-vs-Thanos architecture review that motivated the whole
`2026-07-23-thanos-codex-polish` plan observed that Codex has two clean, orthogonal
control axes:

- an **approval enum** — `UnlessTrusted` / `OnRequest` / `Never`
- a **sandbox policy** — `read-only` / `workspace-write` / `danger-full-access`

Thanos's current permission surface is **five interacting dimensions**:

1. `yolo` (on/off, session-scoped, lockable)
2. `autonomy` (`attended` / `unattended`, registry-owned)
3. `deliveryMode` (`local-only` / `direct-PR` / `no-mistakes`, registry-owned)
4. policy `preset` (`personal` / `team` / `ci`, user-configured in `harness.policy.json`)
5. `specScope` (an explicit spec's `allowedCapabilities`, task-scoped and temporary)

This is powerful (each axis was added to solve a real, specific problem) but hard to
reason about — five dimensions means up to dozens of meaningfully-different states, and
as Sections 4–5 show, several of those interactions are already surprising even to
someone reading the code closely. This doc is the **first step** toward collapsing that
down to Codex's 2-axis shape: **approval posture** × **containment level**. It maps every
distinct behavior the current 5 axes produce onto that target shape, and — per the
instructions for this task — says plainly where the mapping is clean and where it is not,
rather than smoothing over real complexity to make the target model look tidier than the
current system actually is.

## 2. The five axes, grounded in code

### 2.1 `yolo` — `src/permissions/manager.ts`, `src/permissions/yolo-config.ts`

`PermissionManager` (constructed once per session at `src/runtime/register-harness.ts:173`)
holds `_yolo: boolean` and `_locked: boolean`. `isYolo` reads `_locked ? false : _yolo`
(`manager.ts:31`); `setYolo()` is a no-op once locked (`manager.ts:33-36`). Locking is
one-way for the session (`lockYolo()`, `manager.ts:26-29`) and is triggered from three
inputs, all resolved in `register-harness.ts`:

- env `THANOS_YOLO_DISABLED=1` (`yolo-config.ts:1-3`, applied at `register-harness.ts:177`)
- captain-registry `"yolo": "disabled"` (top-level) or a matched project's
  `"yolo": "locked"` (`src/governance/delivery.ts:69`, applied at
  `register-harness.ts:228,262`)

The `/yolo` command (`register-harness.ts:507-563`) additionally **refuses to enable**
yolo when the resolved delivery `autonomy === "unattended"` (`register-harness.ts:517-520`,
message: *"Yolo is not available in unattended autonomy mode."*) — but this is a
command-handler-level courtesy check, not something `GovernanceRuntime.authorize()`
itself enforces (see §5, Hard case 1).

At the gate (`src/runtime/governance-runtime.ts:114-130`), `yolo` short-circuits the
*remaining* ask/risk-gating checks to `"allow"` — but only after: the local-only
egress/push checks (lines 68-83), the policy-deny check (lines 91-95), and the
explicit-spec-scope check (lines 97-112) have all already passed. A critical-tier
operation still sets `snapshotNeeded: true` even under yolo (line 128), and a
permission-manager deny is still consulted and still wins (lines 120-123).

### 2.2 `autonomy` — `src/governance/delivery.ts`, `delivery-types.ts`

`attended` / `unattended` (`delivery-types.ts:12-15`) is resolved **only** from the
trusted captain registry (`~/.pi/agent/projects.json`), never from the repo-committed
ship file (`delivery.ts:65-68`, the "trust-split"). Effect at the gate
(`governance-runtime.ts:152-155`): when `unattended` and the tool is `recognized`
(`src/permissions/risk.ts:128-130` / `governance/tool-call.ts`), the call is auto-allowed
without a prompt — but only *after* the policy-deny, explicit-spec-scope, and
permission-manager-deny checks above it have already run. `unattended` does not bypass
any deny; it only skips the ask.

### 2.3 `deliveryMode` — `src/governance/delivery.ts`, `delivery-overlay.ts`

`local-only` / `direct-PR` / `no-mistakes` (`delivery-types.ts:6-10`), registry-owned like
autonomy, with the same trust-split, and fail-safe to `local-only`/`attended` when no
registry entry matches (`delivery.ts:57,84`). Its **only** current code effect beyond
cosmetics (`/ship` mode, docs, status line) is:

- `local-only` gets extra deny rules from `deliveryPolicyOverlay()`
  (`delivery-overlay.ts:58-106`): `git push`/`gh pr|release|repo create` are denied by
  pattern, checked as an **immutable** step in `GovernanceRuntime.authorize()` before the
  yolo branch (`governance-runtime.ts:65-83`).
- `local-only` also gets an argv-level push classifier,
  `shouldBlockLocalOnlyPush` (`src/governance/push-guard.ts`), applied unconditionally
  regardless of autonomy or yolo (`governance-runtime.ts:81-83`), closing the
  interposed-flag bypass the glob-only overlay misses.
- `local-only` gets an egress check (`evaluateEgress`, `src/governance/egress.ts:113-142`)
  that blocks `network`/`credentialed`/`repo-remote`/`unknown`-class commands. The
  function's own signature takes a `yolo` parameter and has an internal bypass branch for
  it (`egress.ts:122-124`) — but its **only production call site**,
  `governance-runtime.ts:69-73`, passes a **hard-coded literal `false`** for that
  parameter, never `this.ctx.yolo`. So the bypass branch is real code, unit-tested in
  isolation (`tests/governance/egress.test.ts:116-120`), but is **never reachable through
  the actual gate** — confirmed independently by the comment immediately above the call
  site ("delivery denies are immutable"), the `/yolo` confirm-dialog copy
  (`register-harness.ts:538`: "local-only egress guards... still apply"), and
  `resolveDelivery`'s own doc comment (`delivery.ts:65-68`: "enforced ahead of yolo in the
  execution path regardless of mode, so a bypass never crosses it"). `local-only`'s
  egress denies are genuinely immutable to yolo in production, matching
  `docs/governance.md:18`.

**`direct-PR` and `no-mistakes` get zero extra overlay rules** —
`deliveryPolicyOverlay(mode)` returns `[]` for anything other than `local-only`
(`delivery-overlay.ts:59`). On `master` today (pre-Task-7), **`no-mistakes` is not more
restrictive than `direct-PR`** in the actual governance gate. The only thing that
currently would tighten `no-mistakes` is the not-yet-merged Task 7 launcher sandbox
(§3).

### 2.4 policy `preset` — `src/policy/presets.ts`, `loader.ts`, `schema.ts`

`personal` / `team` / `ci` (`src/policy/types.ts:1`). Concretely:

| Preset | Extra deny rules | `audit.enabled` | `headless.defaultDecision` |
|---|---|---|---|
| `personal` | none | `false` | `ask` |
| `team` | `BUILTIN_SENSITIVE_READ_RULES` (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*` reads denied) | `true` | `deny` |
| `ci` | same sensitive-read denies as `team` | `true` | `deny` |

(`presets.ts:41-69`). Preset is **user-configured** in `harness.policy.json`'s `preset`
field (`policy/schema.ts:102`), or defaults hard-coded to `personal`
(`loader.ts:7`: `const DEFAULTS: HarnessPolicy = getPresetPolicy("personal")`) when no
policy file exists. **`loadPolicy()` never reads `deliveryMode` at all** — the choice of
preset is completely independent of delivery mode in the live load path.

**Confirmed dead code (from Task 11):** `presetForMode(mode): PolicyPreset` exists at
`delivery-overlay.ts:109-118` (`local-only→personal`, `direct-PR→team`,
`no-mistakes→ci`) and `docs/governance.md`'s "Delivery modes" table
(`governance.md:75-81`) documents this as if it were real ("Each mode pins a base policy
preset"). But `presetForMode` is called from **nowhere in `src/`** — only from its own
test (`tests/governance/delivery-overlay.test.ts`) and from the not-yet-merged
`feat/config-resolver` branch's `resolveConfig()`, which explicitly names the field
`presetImpliedByModeDocsOnly` and documents in its own doc comment that "this value is
never applied" (`src/config/resolve.ts` on `feat/config-resolver`, and
`docs/configuration.md`'s "Known gap, not papered over" note on that same branch). So: a
`no-mistakes` repo with no hand-written `harness.policy.json` runs under `personal`
preset (`audit: false`, no sensitive-read denies, headless defaults to `ask`) — the exact
opposite of what the mode name and the docs imply. This is the single most important
"docs vs. code" gap this mapping has to account for (see §6).

### 2.5 `specScope` — `src/runtime/governance-runtime.ts`, `register-harness.ts:1729-1760`, `src/spec/types.ts`

An **explicit** spec (created via `--spec`) carries `allowedCapabilities: Capability[]`
(`spec/types.ts:31`, populated by `inferAllowedCapabilities` in `spec/generator.ts:50`).
Once the spec is approved (`register-harness.ts:1729-1745`), its `allowedCapabilities`
become `GovernanceContext.specScope` (`register-harness.ts:1750-1751`) and are enforced
in the gate (`governance-runtime.ts:97-112`) as a **deny-like restriction that is honored
even under yolo** — checked *before* the yolo branch — with an explicit low-risk-call
exemption (a scoped task may still `read`/`ls`/`grep`). This is the only one of the five
axes that is **task-scoped and temporary** rather than session/repo-scoped: it exists
only while a specific explicit spec is the active spec.

## 3. Where Task 7's sandbox slots into "containment"

Task 7 (branch `feat/launcher-sandbox`, not merged to `master`) is the piece that most
directly maps onto "containment level" in the Codex sense — a real OS-level filesystem
boundary, not just a policy-rule allow/deny. `src/security/sandbox.ts` on that branch:

```ts
export function shouldSandbox(input: ShouldSandboxInput): ShouldSandboxResult
```

Engagement rule (verified from the actual function body): sandbox engages when
`platform === "linux" && bwrapAvailable && (mode === "no-mistakes" || autonomy ===
"unattended" || yolo === true)`. When engagement is wanted but `bwrap` is missing:
`no-mistakes` **denies** the run outright (refuses to run unsandboxed, since that mode's
whole point is containment); any other mode **warns** and falls through unsandboxed.
Off-Linux, it never engages (v1 scope).

`buildBwrapArgv()` on that branch is the actual containment mechanism: `--ro-bind / /`
as the base (not `--dev-bind`, which was tried and empirically found to give zero
containment — see the branch's doc comment), with the repo root and scratch tmp rw-bound,
and specific `~/.pi/agent/*` files (`projects.json`, `auth.json`,
`models.local.secret.json`, `trust.json`) forced back to read-only even though their
parent directory is rw-bound — closing a self-escalation hole where a sandboxed
`no-mistakes`/`unattended`/`yolo` run (i.e., exactly the least-trusted contexts) could
otherwise rewrite the very registry that decides whether it gets sandboxed. Network is
allowed in v1 (`--share-net`), so this containment is **filesystem-only**, not
egress-only — it is a different, complementary boundary from `local-only`'s
egress/push denies (§2.3), not a superset of them.

**Mapping:** Task 7's sandbox is the mechanism that should make "workspace-write"
actually mean something at the OS level, not just at the policy-rule level. Today,
without Task 7 merged, "containment" in Thanos is entirely a **policy-rule** fiction
(deny rules on specific bash patterns) — a sandboxed model could still, in principle,
find an unenumerated way to read `~/.ssh` or write outside the repo, because nothing
short of Task 7 stops it at the OS level. This is worth stating plainly: **today's
"containment" is soft (deny-rule-based); Task 7 is the first piece that makes any of it
hard (OS-enforced)**, and only for Linux with `bwrap` present.

## 4. Target model

**Approval posture** (mirrors Codex's `UnlessTrusted`/`OnRequest`/`Never`):

| Posture | Meaning |
|---|---|
| `attended-prompt` | Ask before high/critical actions, as usual. |
| `auto-within-ceiling` | Never ask for recognized/allowed actions, but every deny still blocks. |
| `never-prompt` (≈ yolo) | Skip essentially all prompts; only the immutable floor (explicit deny, local-only egress/push, spec scope, secret scan) still stops it. |

**Containment level** (mirrors Codex's `read-only`/`workspace-write`/`danger-full-access`):

| Level | Meaning |
|---|---|
| `read-only` | No `edit`/`exec` at all — filesystem/process mutation impossible regardless of prompts. |
| `workspace-write` | `edit`/`exec` confined to the repo working tree (and, with Task 7, OS-enforced); no repo-remote egress (`git push`), no network egress by default. |
| `full` | `edit`/`exec` unconfined; network/remote egress allowed. |

## 5. The mapping

Reading the code closely surfaces a structural finding worth stating up front, because
it should shape the future design: **today's five axes split almost cleanly into two
independent groups that map onto the two target axes separately, plus one axis
(`specScope`) that cuts across both and does not collapse cleanly into either.**

- **Approval posture** is driven almost entirely by `{yolo, autonomy}` — `deliveryMode`
  and `preset` have no effect on *whether the harness asks*, only on *what is allowed
  underneath*.
- **Containment level** is driven almost entirely by `{deliveryMode, preset (as
  documented, not as implemented), Task 7 sandbox}` — `yolo`/`autonomy` have no effect on
  the filesystem/egress boundary itself (they only affect whether you're asked before
  crossing it).
- **`specScope`** doesn't live cleanly on either axis (see Hard case 2).

### 5.1 Approval posture ← `{yolo, autonomy}`

| `yolo` | `autonomy` | `yoloLocked`? | → posture | Notes |
|---|---|---|---|---|
| off | `attended` | any | `attended-prompt` | Baseline. |
| off | `unattended` | any | `auto-within-ceiling` | Deny rules still enforced (`governance-runtime.ts:145-149` runs before the autonomy check at 152). |
| on | `attended` | not locked | `never-prompt` | The common "yolo" state. |
| on | `unattended` | not locked | **should be `never-prompt`, but is not a state the UI lets you reach deliberately** | See Hard case 1. |
| requested-on | any | **locked** | (whatever it already was — `attended-prompt` or `auto-within-ceiling`) | `/yolo` refuses with "Yolo is disabled by configuration." (`register-harness.ts:511-514`). |

**Redundant today:** `off/attended` and `off/unattended` are the only two rows that
matter for most users; `on/unattended` is functionally unreachable via the supported UI
path, making the 2×2 grid effectively 3 reachable states, not 4 — i.e. the current
5-axis system already collapses `{yolo × autonomy}` down close to a 3-value enum in
practice, which is exactly the target `approval posture` shape. This is the strongest
piece of "the current system already wants to be 2-axis" evidence in this doc.

### 5.2 Containment level ← `{deliveryMode, preset(actual), Task 7 sandbox}`

Two sub-columns for preset: **actual** (what `loadPolicy()` really returns — always
`personal` unless the user hand-writes `harness.policy.json`) and **documented**
(what `presetForMode`/`governance.md` claim). They diverge on every non-`local-only` row.

| `deliveryMode` | preset (actual) | preset (documented, dead) | Task 7 sandbox (on `feat/launcher-sandbox`) | → containment (today, master) | → containment (if Task 7 merged) |
|---|---|---|---|---|---|
| `local-only` | `personal` | `personal` (matches) | engages iff `unattended` or `yolo` | `workspace-write` (push+egress denied by overlay/push-guard/egress-check; no OS enforcement) | `workspace-write`, OS-enforced when unattended/yolo |
| `direct-PR` | `personal` | `team` (**mismatch** — sensitive-read denies + audit never actually turn on) | engages iff `unattended` or `yolo` | `full` (no push/egress denial exists for this mode at all) | `full`, but OS-sandboxed (filesystem only — network still open) when unattended/yolo |
| `no-mistakes` | `personal` | `ci` (**mismatch**, same gap as above) | **engages unconditionally** (mode alone is enough); **denies the run** if `bwrap` missing | `full` — identical to `direct-PR` in the governance gate; the mode name currently promises more than the code delivers | `workspace-write`-equivalent via OS sandbox (filesystem-only; network still open) — the one row where Task 7 alone closes most of the mode-name/behavior gap |

**Redundant today:** `direct-PR` and `no-mistakes` map to the identical containment
state (`full`) in the actual governance gate, pre-Task-7 — the mode names imply a
strictness ordering (`local-only` < `direct-PR` < `no-mistakes`) that the code does not
currently deliver for the top two. Task 7 is the first thing that gives `no-mistakes`
any teeth beyond its name and its (also currently-informational) `/ship` behavior.

**Contradictory / worth flagging:** if a user hand-writes `harness.policy.json` with
`"preset": "team"` while their registry says `deliveryMode: "local-only"`, they get
`team`'s sensitive-read denies + audit-on *layered with* `local-only`'s push/egress
denies — a real, coherent, tighter state, but one the current five-axis model can
produce in a way that has no name and isn't documented anywhere as an intentional
combination. It happens to fall out of "preset and mode are just independently
composed," which is honest about how the code works, but it means today's system has
**more distinct containment states than the three the mode names advertise** once a user
touches `harness.policy.json` by hand.

### 5.3 Worked examples (full 5-tuple → 2-axis, including `specScope`)

| yolo | autonomy | mode | preset (actual) | specScope active? | → posture | → containment | Note |
|---|---|---|---|---|---|---|---|
| off | attended | local-only | personal | no | `attended-prompt` | `workspace-write` | Common default for a fresh, unregistered repo. |
| off | unattended | no-mistakes | personal | no | `auto-within-ceiling` | `full` (pre-Task-7) / `workspace-write`-OS-enforced (post-Task-7) | The mode name promises strict containment; pre-Task-7 it doesn't deliver it. |
| on | attended | direct-PR | personal | no | `never-prompt` | `full` | "Yolo on a team repo" — network/push are unrestricted by delivery overlay (no deny exists for `direct-PR`); only explicit policy denies / secret-scan / spec-scope still apply. |
| on | attended | local-only | personal | no | `never-prompt` | `workspace-write` | Yolo bypasses the *ask*, not the containment: both the egress check (`governance-runtime.ts:69-73` calls `evaluateEgress` with a hard-coded `false`, never the live yolo flag) and the argv push-guard `shouldBlockLocalOnlyPush` (`governance-runtime.ts:81-83`) run unconditionally, ahead of the yolo branch, and are NOT bypassed. |
| off | attended | any | any | **yes**, `allowedCapabilities: ["read"]` | `attended-prompt` (unchanged) | **collapses toward `read-only` for the spec's duration, regardless of mode/preset** | The one row where `specScope` visibly overrides what mode/preset would otherwise allow — see Hard case 2. |
| on | attended | any | any | **yes**, `allowedCapabilities: ["read","edit"]` | `never-prompt` (unchanged) | between `read-only` and `workspace-write` — no exec, so not quite either | See Hard case 2. |

## 6. Hard cases — where the mapping does not collapse cleanly

**Hard case 1 — `yolo=on & autonomy=unattended` is a state the code can compute but the
UI refuses to create.** `GovernanceRuntime.authorize()` checks `yolo` first
(`governance-runtime.ts:119`) with no reference to `autonomy` at all — if both were ever
simultaneously true, yolo would simply win, exactly as `on/attended` does. The *only*
thing preventing this combination from existing is a courtesy check inside the `/yolo`
command handler (`register-harness.ts:517-520`), which reads the delivery state at
command-invocation time and refuses to flip `yolo` on if `autonomy` is currently
`unattended`. There is no code path that unsets `yolo` if autonomy *later* becomes
unattended (e.g., a hand-edit to `~/.pi/agent/projects.json` between sessions) — it's
just that in practice a single running session can't reach this combination through its
own supported controls (`/delivery` only ever changes `mode`, never `autonomy` —
`delivery-select.ts:25-27`). **Recommendation for the future redesign:** if approval
posture becomes a true single enum (not two booleans), this ambiguity disappears by
construction — `never-prompt` simply subsumes what `unattended` used to mean. That is a
genuine simplification this redesign would buy, not just a renaming.

**Hard case 2 — `specScope` is a capability allowlist, not a containment level, and the
two don't nest the same way.** Containment levels as defined in §4 are **nested**:
`workspace-write` implies you can still do everything `read-only` can, `full` implies
everything `workspace-write` can. `specScope` is an arbitrary subset of
`{read, edit, exec, task, interaction}` inferred from the user's prompt
(`spec/generator.ts`'s `inferAllowedCapabilities`) — nothing stops a spec from having
`allowedCapabilities: ["read", "exec"]` (no `edit`), which has no equivalent point on the
containment ladder (it's not `read-only` because exec is allowed; it's not
`workspace-write` because edit is denied). It is also **temporal** (bound to one active
explicit spec) where the other four axes are session/repo-scoped, and it is enforced
**even under `never-prompt`/yolo** (governance-runtime.ts:97-112, checked before the
yolo branch) — meaning it behaves like a per-task containment override that can be
*tighter* than whatever the session's real containment level is, for as long as the spec
is active. **This is the one axis that genuinely does not fold into a clean 2-axis
model** without either (a) generalizing "containment level" from 3 fixed rungs to an
arbitrary capability set (losing the simplicity Codex's model has), or (b) keeping
`specScope` as an explicit third, orthogonal, temporary override layer that both target
axes must independently consult — which is honest, but means the "2-axis" target is
really "2 axes + one temporary override," not a true 2-tuple. This doc recommends the
future redesign state that explicitly rather than quietly dropping `specScope`'s
non-nesting cases.

**Hard case 3 — `preset`'s real effects (audit, headless defaults, sensitive-file
denies) aren't really a "containment level" at all.** Section 5.2 forces `preset` into
the containment column because that's the closest fit among the two target axes, but
looking at what `preset` *actually changes* (`presets.ts:41-69`: audit on/off, headless
default decision, a fixed list of sensitive-read denies) — none of that is "how contained
is exec/filesystem access," it's closer to "how much do we log and how paranoid are the
built-in secret-file guards." Forcing it onto the containment axis is a simplification
this doc is making explicitly, not a claim that it's a natural fit — see the
recommendation in §7.

## 7. The `presetForMode` gap — recommendation for the future implementation plan

Confirmed (§2.4): `presetForMode()` exists, is fully implemented, is unit-tested, and is
called from **zero production code paths**. `docs/governance.md` describes it as real
behavior ("Each mode pins a base policy preset"). The actual default is always
`personal`, for every delivery mode, until a user hand-writes `harness.policy.json`.

Two ways to close this gap, for the *future* implementation plan to choose between (not
decided here):

1. **Wire it for real.** Have delivery-mode resolution actually select the base preset
   (`no-mistakes → ci`, `direct-PR → team`, `local-only → personal`) unless the user's
   `harness.policy.json` explicitly overrides `preset`. This makes the mode names finally
   mean what the docs already claim, and pairs naturally with this redesign: containment
   level could then be legitimately derived from `{mode, sandbox}` *and* `preset`'s
   sensitive-read denies together, instead of `preset` floating free. **Risk:** this is a
   silent behavior change for every existing `direct-PR`/`no-mistakes` repo that has no
   `harness.policy.json` today — they would newly get `audit.enabled: true`,
   `headless.defaultDecision: "deny"`, and the sensitive-read denies, none of which they
   opted into. That's a real regression-risk surface (§8), not a pure improvement.

2. **Formally deprecate the documented mapping.** Delete/rewrite the
   `docs/governance.md` claim that mode "pins" a preset, keep `preset` fully
   user-controlled and independent of `mode` (matching what the code has always actually
   done), and let the future 2-axis redesign treat containment level as driven purely by
   `{deliveryMode, Task 7 sandbox}` — with `preset`'s audit/sensitive-read/headless
   concerns split out as their own explicitly-named, still-independent knob (not
   pretending to be part of "containment").

**This doc's non-binding recommendation:** lean toward (2). `preset`'s real effects
(§6, Hard case 3) were never a good fit for "containment" in the first place, and
wiring (1) retroactively would change effective behavior for existing repos with no
opt-in — exactly the kind of surprise a *redesign whose whole point is to make behavior
easier to reason about* shouldn't introduce as a side effect. But this is a
recommendation for whoever writes the actual implementation plan, weighed against
whatever that plan's authors learn once they scope it — it is explicitly **not** a
decision this document is making.

## 8. Migration risks

- **Silent behavior changes if `presetForMode` is retroactively wired** (§7, option 1) —
  existing `direct-PR`/`no-mistakes` repos with no `harness.policy.json` would newly
  inherit `team`/`ci`'s sensitive-read denies, `audit.enabled: true`, and
  `headless.defaultDecision: "deny"`. Any headless/CI automation currently relying on
  `personal`'s `ask`-that-degrades-gracefully-or-`allow` headless behavior could start
  failing (`resolveHeadlessDecision`, `src/governance/headless.ts:11-31`, forces `ask`
  for `team`/`ci` presets even if configured `allow`).
- **`{yolo, autonomy}` → single `approvalPosture` enum removes the (already-fragile)
  `on/unattended` gap** (Hard case 1) — low risk in practice (unreachable via supported
  UI today) but any external tooling that pokes at `PermissionManager` directly (tests
  do: `tests/permissions/manager.test.ts`, `tests/permissions/yolo-lock.test.ts`) would
  need updating if `setYolo`/`isYolo` are replaced by a single enum setter.
- **Schema/file-format churn**: `~/.pi/agent/projects.json` (registry: `mode`,
  `autonomy`, `yolo`), `<repo>/.thanos/delivery.json` (ship file: `gates`,
  `defaultBranch`, `merge`), and `harness.policy.json` (`preset`, `rules`, `audit`,
  `headless`) are all committed/persisted formats with existing users. A 2-axis redesign
  that changes what these files *mean* (even without renaming keys) risks silently
  reinterpreting an existing user's config the moment the new axes become authoritative.
- **`specScope`'s non-nesting shape** (Hard case 2) means any 2-axis implementation that
  tries to fold spec scope into `containmentLevel` will either need a capability-set
  generalization (scope creep on "containment level" as a concept) or must keep spec
  scope as a visible third override — either choice is more code than the current
  isolated `GovernanceContext.specScope: Capability[] | undefined` field, which is small
  and well-tested (`tests/hooks/autonomy.test.ts:135-145`) today.

## 9. Non-breaking rollout sketch (for the future implementation plan)

This is a sketch, not a plan — the actual sequencing, tests, and PR boundaries belong to
the future implementation plan this doc feeds.

1. **Phase A (this doc).** Design-only mapping — done.
2. **Phase B — dual model, no behavior change.** Implement pure derivation functions
   (`deriveApprovalPosture({yolo, autonomy}) → Posture`,
   `deriveContainmentLevel({mode, preset, sandboxState}) → Level`) that compute the new
   axes *from* the existing five, without changing what `GovernanceRuntime.authorize()`
   actually does. Land these next to the existing gate (the `feat/config-resolver`
   branch's `resolveConfig()` is a natural home/precedent for this kind of
   pure-consolidation-only work) with full test coverage of every row in §5's tables,
   including the hard cases. No wire-format changes; old fields remain authoritative.
3. **Phase C — internal switch, same wire format.** Change `GovernanceRuntime.authorize()`
   to consult the derived `approvalPosture`/`containmentLevel` internally instead of
   re-deriving ad hoc from `{yolo, autonomy, mode, preset}` at each check site — but
   compute those derived values from the *same* `projects.json`/`harness.policy.json`
   inputs, so no user-visible config changes. This is the point where Hard case 1
   (the `yolo=on & autonomy=unattended` ambiguity) gets resolved deliberately, by
   construction, once the two booleans collapse into one enum — not left as a state the
   UI merely discourages.
4. **Phase D — new-format config surfaces, old ones still read.** Offer
   `/policy posture=<x> containment=<y>` (or equivalent) as a new, more direct way to set
   the state, while `/yolo`, `/delivery`, and `harness.policy.json`'s `preset` continue to
   work as thin shims that compute the same underlying posture/containment. Deprecation
   warnings (not removals) on the old commands' output, pointing at the new surface.
5. **Phase E — schema migration, opt-in.** Only once Phase D has shipped and been stable
   for a deprecation window, offer a migration script for `~/.pi/agent/projects.json` /
   `harness.policy.json` to the new schema, with a version bump
   (`RegistrySchema`/`ShipSchema`/`HarnessPolicy` all already carry a `version: 1`
   literal — a natural place to bump to `2` and branch parsing on it, exactly the pattern
   `delivery-types.ts`'s `parseRegistry`/`parseShipFile` already use for throw-on-invalid
   parsing). Old-format files continue to parse (shimmed) indefinitely, or for a stated
   deprecation period — a decision for that future plan, not this one.

At every phase above, the immutable floor described in `governance.md` (explicit policy
deny, `local-only` push guard, Lens Lite secret scanning) must keep working exactly as it
does today — none of this rollout should ever be the thing that lets yolo/never-prompt
cross a deny it couldn't cross before.

## 10. Summary

Today's five axes are not five independent knobs in practice: `{yolo, autonomy}` already
behaves like a near-3-value enum (§5.1), and `{deliveryMode, preset, Task 7 sandbox}`
already behaves like a near-containment-level concept once you account for the fact that
`preset` doesn't actually vary by mode (§5.2) — which is itself the headline finding of
this doc, not a footnote: **the two-axis target isn't a simplification imposed from
outside, it's close to what the code already does once `presetForMode`'s dead code is
accounted for honestly.** The one piece that resists the 2-axis shape cleanly is
`specScope` (§6, Hard case 2) — a temporal, non-nesting capability allowlist that this
doc recommends the future redesign keep as an explicit third override rather than force
onto either axis. Building any of this — new types, a new resolver, file-format changes
— is out of scope for this document; it exists so the team writing that implementation
plan starts from an honest picture of what the code does today, not from the docs'
version of what it does.
