# AI Coding Harness Permission And Delivery Modes

**Researched:** 2026-07-21  
**Method:** First-party product documentation, first-party source code, and first-party repository docs only.  
**Question:** How do Codex, Claude Code, OpenCode, and Pi handle permission bypasses, approval gating, and delivery-mode-style controls?

## Bottom Line

- **Codex** has an explicit permissions model built from two knobs: **sandbox modes** (`read-only`, `workspace-write`, `danger-full-access`) and **approval policies** (`untrusted`, `on-request`, `never`). Its clearest YOLO-equivalent is `--dangerously-bypass-approvals-and-sandbox` / `--yolo`, which removes both sandbox and approval prompts. It also exposes lower-risk presets like `Auto` and supports automatic approval review via `approvals_reviewer = "auto_review"`. Sources: https://developers.openai.com/codex/agent-approvals-security , https://developers.openai.com/codex/concepts/sandboxing , https://developers.openai.com/codex/cli/reference
- **Claude Code** has an explicit **permission mode** concept. The modes are `default`/Manual, `acceptEdits`, `plan`, `auto`, `dontAsk`, and `bypassPermissions`. Its strongest YOLO-equivalent is `bypassPermissions`, but it is not a total bypass: explicit `ask` rules, some connector/MCP interaction requirements, and root/home destructive removals can still prompt. Sources: https://code.claude.com/docs/en/permission-modes , https://code.claude.com/docs/en/permissions , https://code.claude.com/docs/en/auto-mode-config
- **OpenCode** does **not** document a separate delivery-mode concept. Its model is a permission ruleset (`allow` / `ask` / `deny`) plus runtime toggles. The documented reduced-friction mode is `--auto`, which auto-approves requests that are not explicitly denied. OpenCode also has a first-party YOLO concept in its own repo history (`--yolo` / `--dangerously-skip-permissions`), but the current public permissions docs emphasize `--auto`, not named delivery modes. Sources: https://opencode.ai/docs/permissions/ , https://github.com/sst/opencode/blob/9ad6588f/packages/web/src/content/docs/permissions.mdx , https://github.com/sst/opencode/blob/9ad6588f/packages/opencode/src/permission/index.ts , https://github.com/anomalyco/opencode/pull/11833 , https://github.com/anomalyco/opencode/pull/7137
- **Pi** has an explicit **delivery mode** concept and a separate **autonomy** setting. The delivery modes are `local-only`, `direct-PR`, and `no-mistakes`; the autonomy values are `attended` and `unattended`. Pi also has a true **yolo** bypass for the session, but live docs and source distinguish it from `unattended`: `unattended` auto-approves only within the policy ceiling, while `yolo` bypasses permission checks and policy checks. Pi can also hard-disable yolo by config. Sources: `docs/governance.md`, `docs/guide.md`, `docs/reference.md`, `docs/configuration.md`, `src/permissions/manager.ts`, `src/runtime/register-harness.ts` in this repository.

## Codex

### Does it have an explicit delivery mode concept?

No separate **delivery mode** concept appears in the official Codex docs I reviewed. Instead, Codex expresses control through **sandbox mode** plus **approval policy**, and the docs explicitly describe them as two layers that work together. Sources: https://developers.openai.com/codex/agent-approvals-security , https://developers.openai.com/codex/concepts/sandboxing

### What are the modes called?

Codex documents these common **sandbox modes**:

- `read-only`
- `workspace-write`
- `danger-full-access`

It also documents these common **approval policies**:

- `untrusted`
- `on-request`
- `never`

The official docs also describe a named preset, **Auto**, as `workspace-write` plus `on-request`, and describe **Full access** as `danger-full-access` plus `never`. Sources: https://developers.openai.com/codex/concepts/sandboxing , https://developers.openai.com/codex/agent-approvals-security

### Is there a YOLO / all-permissions-bypass equivalent?

Yes. Codex explicitly documents `--dangerously-bypass-approvals-and-sandbox` and says the alias is `--yolo`. The docs describe this as **no sandbox; no approvals**. Sources: https://developers.openai.com/codex/agent-approvals-security , https://developers.openai.com/codex/cli/reference

### Important nuance

- `--ask-for-approval never` disables approval prompts, but it is **not** the same as full YOLO by itself, because it can still be paired with constrained sandbox modes. Source: https://developers.openai.com/codex/agent-approvals-security
- Codex also has an intermediate automatic-review path: when approvals are interactive, `approvals_reviewer = "auto_review"` can route eligible approval requests through a reviewer agent instead of the user. That changes who reviews approval requests, but does **not** widen the sandbox boundary. Sources: https://developers.openai.com/codex/agent-approvals-security , https://developers.openai.com/codex/concepts/sandboxing , https://github.com/openai/codex/pull/18504

## Claude Code

### Does it have an explicit delivery mode concept?

Claude Code does **not** use a separate "delivery mode" concept. It has an explicit **permission mode** concept, layered with permission rules (`allow`, `ask`, `deny`) and hooks. Sources: https://code.claude.com/docs/en/permission-modes , https://code.claude.com/docs/en/permissions

### What are the modes called?

Claude Code's official permission mode docs list these modes:

- `default` (labeled **Manual** in UI/CLI)
- `acceptEdits`
- `plan`
- `auto`
- `dontAsk`
- `bypassPermissions`

Sources: https://code.claude.com/docs/en/permission-modes , https://code.claude.com/docs/en/permissions

### Is there a YOLO / all-permissions-bypass equivalent?

Yes, but with caveats. `bypassPermissions` is the strongest equivalent. Official docs say it "skips permission prompts" and the permission-modes page describes it as "Everything". Sources: https://code.claude.com/docs/en/permission-modes , https://code.claude.com/docs/en/permissions

However, Claude's own docs also say `bypassPermissions` is **not** a total bypass of every gating mechanism:

- explicit `ask` rules still prompt
- connector tools an organization set to `ask` still prompt
- MCP tools marked `requiresUserInteraction` still prompt
- root and home directory removals such as `rm -rf /` and `rm -rf ~` still prompt as a circuit breaker

Sources: https://code.claude.com/docs/en/permission-modes , https://code.claude.com/docs/en/permissions

### Important nuance

- `auto` is the lower-risk "let it run" mode. The docs say it auto-approves tool calls with background safety checks and routes actions through a classifier. Deny and explicit ask rules run before the classifier and still block or prompt. Source: https://code.claude.com/docs/en/auto-mode-config
- `dontAsk` is not YOLO. It auto-denies anything not pre-approved instead of broadly allowing actions. Sources: https://code.claude.com/docs/en/permission-modes , https://code.claude.com/docs/en/permissions

## OpenCode

### Does it have an explicit delivery mode concept?

No documented **delivery mode** concept appears in the official OpenCode permissions docs. The documented control surface is a **permission** configuration and an **auto mode** toggle. Sources: https://opencode.ai/docs/permissions/ , https://github.com/sst/opencode/blob/9ad6588f/packages/web/src/content/docs/permissions.mdx

### What is the permission model instead?

OpenCode says each permission rule resolves to one of:

- `allow`
- `ask`
- `deny`

The docs list tool-scoped permission keys such as `read`, `edit`, `bash`, `task`, `skill`, `webfetch`, `websearch`, `external_directory`, and `doom_loop`. They also say most permissions default to `allow`, while `doom_loop` and `external_directory` default to `ask`. Sources: https://opencode.ai/docs/permissions/ , https://github.com/sst/opencode/blob/9ad6588f/packages/web/src/content/docs/permissions.mdx

The first-party source also shows the permission engine evaluating rules and only prompting when the matched action is `ask`; if a rule matches `deny`, it throws a denial error, and if it matches `allow`, it proceeds. Source: https://github.com/sst/opencode/blob/9ad6588f/packages/opencode/src/permission/index.ts

### What modes are documented?

OpenCode's public docs document **Auto mode** rather than a broader delivery-mode matrix. `--auto` automatically approves permission requests that are not explicitly denied, and explicit `deny` rules remain enforced. Sources: https://opencode.ai/docs/permissions/ , https://github.com/sst/opencode/blob/9ad6588f/packages/web/src/content/docs/permissions.mdx

### Is there a YOLO / all-permissions-bypass equivalent?

There is a first-party YOLO-equivalent in OpenCode's own repository history, but it is less prominent in the current public docs than `--auto`.

- PR #7137 added `--dangerously-skip-permissions` and `OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS=true`, describing it as skipping `ask` permission prompts while still respecting `deny` rules. Source: https://github.com/anomalyco/opencode/pull/7137
- PR #11833 added explicit **YOLO mode** with `opencode --yolo`, `OPENCODE_YOLO=true`, config support, and session-only or persistent toggles, again describing it as auto-approving `ask` prompts while still respecting explicit `deny` rules. Source: https://github.com/anomalyco/opencode/pull/11833

So OpenCode does have a first-party **YOLO-style bypass**, but based on the first-party materials reviewed here it is best described as **auto-allow everything that would otherwise ask, while still honoring explicit deny rules**, not as a complete removal of the permission system. Sources: https://github.com/anomalyco/opencode/pull/7137 , https://github.com/anomalyco/opencode/pull/11833

## Pi

### Does it have an explicit delivery mode concept?

Yes. Pi's first-party repo docs explicitly define **delivery modes** and describe them as deciding "how far a repo's work is allowed to travel and how autonomously Thanos may act in it." Source: `docs/governance.md`

### What are the modes called?

Pi documents three delivery modes:

- `local-only`
- `direct-PR`
- `no-mistakes`

It also documents a separate autonomy setting:

- `attended`
- `unattended`

Sources: `docs/governance.md`, `docs/guide.md`, `docs/reference.md`

### What do those modes mean?

- `local-only` means work never leaves the machine; `git push` is denied; `/ship` performs a fast-forward-only local merge. Source: `docs/governance.md`
- `direct-PR` is the team-flow mode; push/PR flow is allowed by policy, but `/ship` is informational in v1. Source: `docs/governance.md`
- `no-mistakes` is the strictest preset for high-stakes repos; `/ship` is informational in v1. Source: `docs/governance.md`
- `attended` means Pi prompts within the policy ceiling. Source: `docs/governance.md`
- `unattended` means Pi auto-approves within the ceiling and deny rules still block. Sources: `docs/governance.md`, `docs/guide.md`

### Is there a YOLO / all-permissions-bypass equivalent?

Yes. Pi has an explicit `yolo` mode.

- The user docs say `/yolo` or `Ctrl+Shift+Y` bypasses the whole permission layer for the session, while Lens Lite secret scanning still runs. Source: `docs/guide.md`
- The reference page says `/yolo` bypasses Thanos permission checks and can be refused when yolo is locked. Source: `docs/reference.md`
- The live governance docs say yolo short-circuits to `allow` immediately and is checked before policy/permission deny, autonomy, and interactive prompt. Source: `docs/governance.md`
- The source code confirms `PermissionManager.evaluate()` returns `allow` immediately when `isYolo` is on. Source: `src/permissions/manager.ts`

### Important nuance

Pi explicitly distinguishes **unattended** from **yolo**:

- `unattended` only auto-approves actions the current delivery-mode policy ceiling already allows; deny rules still block. Sources: `docs/governance.md`, `docs/guide.md`
- `yolo` bypasses permission checks and policy checks for the session. The `/yolo` command description in source says it "skips all permission prompts and policy checks." Source: `src/runtime/register-harness.ts`

Pi also supports **yolo lockout**:

- docs say yolo can be disabled by env `THANOS_YOLO_DISABLED=1`, by registry top-level `"yolo": "disabled"`, or by a matched project entry with `"yolo": "locked"`. Source: `docs/governance.md`
- source implements `lockYolo()`, forces `_yolo = false`, and makes `setYolo(true)` a no-op when locked. Source: `src/permissions/manager.ts`
- source also refuses `/yolo` in `unattended` autonomy mode and outside `local-only` mode. Source: `src/runtime/register-harness.ts`

## Cross-Platform Comparison

| Platform | Explicit delivery mode concept? | Modes / knobs | YOLO-equivalent? | Notes |
| --- | --- | --- | --- | --- |
| Codex | No separate delivery mode | Sandbox: `read-only`, `workspace-write`, `danger-full-access`; approvals: `untrusted`, `on-request`, `never`; preset `Auto` | Yes: `--dangerously-bypass-approvals-and-sandbox` / `--yolo` | Strongest bypass removes both sandbox and approvals. Sources: https://developers.openai.com/codex/agent-approvals-security , https://developers.openai.com/codex/concepts/sandboxing |
| Claude Code | No separate delivery mode | `default`/Manual, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions` | Yes: `bypassPermissions` | Not absolute: explicit ask rules and some circuit breakers still prompt. Sources: https://code.claude.com/docs/en/permission-modes , https://code.claude.com/docs/en/permissions |
| OpenCode | No | Permission rules: `allow` / `ask` / `deny`; documented runtime toggle `--auto` | Yes, but repo-source-first: `--yolo` / `--dangerously-skip-permissions` | Current public docs foreground `--auto`; repo PRs/source show YOLO-style bypass that still honors explicit `deny`. Sources: https://opencode.ai/docs/permissions/ , https://github.com/anomalyco/opencode/pull/11833 , https://github.com/anomalyco/opencode/pull/7137 |
| Pi | Yes | Delivery: `local-only`, `direct-PR`, `no-mistakes`; autonomy: `attended`, `unattended` | Yes: `/yolo` | `unattended` is the "frictionless but still governed" mode; yolo is stronger and can be locked out. Sources: `docs/governance.md`, `docs/guide.md`, `src/permissions/manager.ts`, `src/runtime/register-harness.ts` |

## Notes On Evidence Quality

- For **Codex**, **Claude Code**, and **OpenCode**, I relied on official product docs and official repository pages or PRs.
- For **Pi**, the primary sources are this repository's own first-party docs and source code because Pi is the codebase under inspection.
- For **Pi specifically**, I treated `docs/plans/2026-06-23-thanos-delivery-modes-design.md` as design history only, not the current source of truth, because the live user docs and source implement a more specific behavior surface than that older design note.
