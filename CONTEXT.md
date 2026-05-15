# Thanos — Context

## Glossary

**Thanos**
The Pi config/harness layer living at `~/.pi`. Adds capability-based permissions, an ambient spec lifecycle, and subagent delegation to Pi. Distributed at `github.com/fchery87/thanos` with a low-friction bootstrap installer that should install from pinned, integrity-checked releases rather than mutable branch tips.

**Team-grade Governance Layer**
The intended product position for Thanos: a policy, verification, audit, and delegation layer that makes Pi safe and predictable enough for shared team use. "Team-grade" describes adoption pattern and quality bar — each developer runs the Harness locally, but teams share a `harness.policy.json` committed to the project repo. There is no central policy server or multi-tenant runtime; governance is per-developer but coordinated via version-controlled policy.
_Avoid_: Personal productivity harness, multi-tenant runtime

**Pi**
The installed coding agent CLI — package `@earendil-works/pi-coding-agent` v0.74.0. Loaded via nvm node v24.15.0. Binary at `~/.nvm/versions/node/v24.15.0/bin/pi`.

**Extension**
A TypeScript module auto-discovered by Pi from `~/.pi/agent/extensions/*/index.ts` or via the `"pi": { "extensions": [...] }` field in a `package.json` adjacent to the source files.

**PermissionManager**
Session-scoped singleton that holds `PermissionRule[]` and evaluates `allow | deny | ask` decisions for each tool call. Rules use last-rule-wins semantics. Created fresh on each Pi session (Pi reloads extensions on session switch).

**PermissionRule**
`{ capability, pattern?, decision, source }`. Capabilities are `read | edit | exec | task`. Pattern is an optional glob matched against the tool's target (file path or command string). Source tracks whether the rule came from defaults, the user's session decisions, or a spec.

**Policy File**
A durable, reviewable configuration source that defines Harness governance rules for tools, paths, commands, MCP tools, subagents, headless mode, and sensitive reads.
_Avoid_: Session memory, prompt instructions

**Policy Schema**
The validated JSON shape for a **Policy File**, designed to be diffable, CI-checkable, and readable without executing code.
_Avoid_: Executable TypeScript config

**Policy-first Teaching Docs**
Harness documentation style where each feature is explained by the risk it controls, the policy rule that expresses it, and the failure behavior users should expect.
_Avoid_: Feature-list documentation, abstract architecture notes

**Capability**
One of four values: `read | edit | exec | task`. Maps to Pi built-in tools as follows:
- `read` → `read`, `ls`, `find`, `grep` (all low-risk, always allowed before rule check)
- `edit` → `write`, `edit`
- `exec` → `bash`
- `task` → `task` (custom registered tool)

**Governed Tool Call**
The normalized representation of a Pi `tool_call` before execution: tool name, input, safe target, **Capability**, **Risk Tier**, command family when applicable, matching **Policy File** rule, and **Audit Log** target. This is the domain concept for concentrating tool governance behaviour before permission prompts, policy denials, secret scanning, snapshots, and evidence capture.
_Avoid_: Recomputing tool metadata separately in hooks, slash commands, audit code, or spec evidence code

**Sensitive Read**
A read-like tool call that targets credentials, secrets, auth material, token stores, or other files that team policy says the agent must not inspect.
_Avoid_: Low-risk read

**Sensitive Read Default**
Harness denies known secret and credential path patterns before generic read allowance, unless a team explicitly defines a narrow allow rule.
_Avoid_: Allow-by-default reads

**Policy Denial**
A visible block result that explains which safe policy rule stopped an action without exposing the protected content.
_Avoid_: Silent block, secret-revealing error

**Audit Log**
A durable record of Harness governance decisions, including policy denials, approvals, agent identity, rule source, and safe target metadata.
_Avoid_: Console-only notification, raw secret capture

**Rule ID**
A stable identifier for a policy rule, used to connect policy files, policy denials, audit log entries, docs, and reviews.
_Avoid_: Anonymous policy rule

**Risk Tier**
`low | medium | high | critical`. Assigned per tool name before capability rule evaluation. Low-risk tools (`read`, `ls`, `find`, `grep`) bypass rule evaluation entirely — always allowed. High/critical tools always trigger `ask` unless an explicit `allow` rule exists.

**SpecEngine**
Singleton per session. Runs classify → generate → verify lifecycle. `reset()` called at each `before_agent_start`. `verify()` called at `agent_end`.

**SpecTier**
`instant | ambient | explicit`. Instant: no spec generated. Ambient: spec generated silently; drift warnings + verify table shown after run. Explicit: spec shown in TUI for `y/n` approval before execution (only triggered via `--spec` flag, and only for non-instant messages).

**`--spec` flag**
Session-level Pi CLI flag. When set, upgrades `ambient` tier to `explicit`. Never affects `instant` tier — read-only questions always run immediately.

**Specialist**
One of `ask | plan | build | generic`. Each maps to a markdown agent file in `~/.pi/agent/agents/`. The markdown file specifies the system prompt, optional `tools` allowlist, and optional `model`.

**Subagent**
A separate `pi` subprocess spawned by the `task` tool. Runs in JSON mode (`--mode json`). Receives `HARNESS_SUBAGENT=1` env var so the harness extension does not register the `task` tool inside it (enforces depth limit of 1). Capability ceiling enforced via the `tools` frontmatter field in the agent markdown file.

**HARNESS_SUBAGENT**
Environment variable set to `"1"` when spawning a subagent subprocess. Causes the harness extension to skip registering the `task` tool, preventing recursive delegation.

**JSON mode output**
Pi's `--mode json` outputs JSONL — one JSON event object per line. The `agent_end` line contains `messages: AgentMessage[]`. `extractFinalText()` scans lines in reverse for `agent_end` and returns the last assistant text part.

**`before_agent_start`**
Pi lifecycle event fired once per user prompt (not per steering message). Used to classify the message and reset/initialize the SpecEngine for the new task.

**`agent_end`**
Pi lifecycle event fired once per user prompt after the full agent loop completes. Used to display spec verification results.

**`tool_call`**
Pi lifecycle event fired before each tool execution. Returning `{ block: true, reason }` prevents the tool from running. Used for the permission gate. When `ctx.hasUI` is false (print/RPC mode), `ask`-tier calls are blocked automatically.

**`tool_result`**
Pi lifecycle event fired after each tool execution. Used to collect tool output text for spec verification.

## Relationships

- **Thanos** is positioned as a **Team-grade Governance Layer** for **Pi**.
- A **Team-grade Governance Layer** requires durable **PermissionRule** configuration, auditable **tool_call** decisions, and trustworthy **SpecEngine** verification.
- A **Policy File** is the source of durable team governance, while session approvals only provide temporary exceptions.
- A **Policy File** conforms to a **Policy Schema** before Harness applies any of its rules.
- **Policy-first Teaching Docs** explain **Thanos** through practical governance questions, one mental model at a time.
- A **Sensitive Read** is governed by the **Policy File** before normal low-risk read defaults apply.
- **Sensitive Read Default** is deny-first for known secret patterns, with explicit narrow allow rules for exceptions.
- A **Policy Denial** reports the matched rule, rule source, and remediation path while withholding protected content.
- An **Audit Log** records policy decisions from parent agents, subagents, interactive sessions, and headless runs.
- A **Rule ID** is the join key between **Policy File** rules, **Policy Denial** messages, and **Audit Log** entries.

## Approved direction

- **Policy and audit**: Audit logs use safe representations by default; policy rules have stable **Rule ID** values; headless mode fails closed; session approvals never create durable policy; Harness ships `personal`, `team`, and `ci` policy presets.
- **Sensitive reads**: Sensitive-read rules apply to `read`, `ls`, `find`, and `grep`; denials reveal the matched policy pattern without exposing protected content; exceptions must be narrow and explicit.
- **Command governance**: Bash commands are governed by command family before pattern matching; destructive commands have built-in denies or explicit-policy requirements; network commands require explicit policy.
- **Spec system**: Specs become structured JSON; verification requires evidence from diffs, command exit codes, tests, or explicit evidence records; unmet criteria warn in interactive mode and fail in CI/headless governance mode; explicit spec approval includes scope, allowed capabilities, and verification plan.
- **Subagents**: Subagents inherit parent policy as a ceiling; each subagent has a capability ceiling; subagents have timeouts and max turns; subagent results include structured metadata; transcripts are retained with policy-safe redaction.
- **Docs**: Documentation starts with concrete risks, uses question-led teaching, provides copy-pasteable JSON examples, separates team policy from personal preference, and explains what happens when policy blocks an action.
- **Distribution**: Keep the bootstrap install UX. By default, the bootstrap resolves and prints the latest stable release version, downloads a versioned release source tarball (`thanos-vX.Y.Z.tar.gz`), and verifies it against a `SHA256SUMS` file published as a GitHub Release asset by release automation after typecheck, lint, and tests pass. Teams can pin with `THANOS_VERSION=vX.Y.Z`. The installer fails closed when neither `sha256sum` nor `shasum -a 256` is available, prints release version, artifact URL, checksum URL, computed checksum, install directory, and Pi version, and may auto-install Pi through the available `bun` or `npm` package manager. Mutable `master`/branch-tip shell installs are too weak for a **Team-grade Governance Layer** trust boundary; signatures can be added later when release key management is mature.
- **Installer verification**: Treat `scripts/install.sh` as a security boundary. Add static validation when available and fixture-driven tests for version resolution, checksum verification, and checksum failure behavior.
- **Build order**: Policy schema and loader, sensitive-read deny rules, policy denial shape, audit log, headless fail-closed behavior, command governance, structured spec generation, evidence-based verification, subagent policy inheritance, then policy-first docs.

## Flagged ambiguities

- "Thanos system" has been resolved as **Team-grade Governance Layer**, not a personal productivity harness.
- "Governance" now implies durable policy, auditability, and verification stronger than the current heuristic implementation.
- "Permission rules" now means durable **Policy File** rules by default; session rules are temporary prompt-cycle decisions.
- "Policy config" has been resolved as declarative JSON validated by **Policy Schema**, not executable TypeScript.
- Harness docs should follow a question-led teaching style inspired by Matt Pocock's public TypeScript writing: precise questions, tight mental models, small examples, and team-shareable rules.
- "Read is low-risk" is no longer universally true; **Sensitive Read** rules take priority over generic read allowance.
- Sensitive-read protection starts from built-in deny patterns for credentials and secrets, not from team-authored rules alone.
- Sensitive-read failures are visible **Policy Denial** events, not silent hard blocks.
- Policy decisions must be durable **Audit Log** events, not just transient UI notifications.
- The approved build order prioritizes governance core decisions before expanding subagent capability, because subagents amplify whatever policy model exists.
- Installer distribution has been resolved as latest-stable-by-default bootstrap with an explicit `THANOS_VERSION=vX.Y.Z` override and SHA256-verified GitHub Release source tarballs, not clone-first install, mutable branch-tip `curl|sh`, silent latest installs, prerelease-by-default installs, unverified fallback installs, Pi version pinning, or signature verification from day one.
- `thanos update` should update to latest stable by default and respect `THANOS_VERSION=vX.Y.Z` for pinned updates; prereleases are only installable when explicitly requested by version.
- README/install docs should stop advertising raw `master` install URLs and instead document latest-release bootstrap plus optional `THANOS_VERSION` pinning.
