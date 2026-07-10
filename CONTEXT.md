# Thanos — Context

## Glossary

**Thanos**
The Pi config/harness layer living at `~/.pi`. Thanos is now intended to grow from a governance extension into a broader Oh-my-pi-style **Agent Distribution** while preserving governance as a first-class differentiator. Distributed at `github.com/fchery87/thanos` with a low-friction bootstrap installer that should install from pinned, integrity-checked releases rather than mutable branch tips.

**Agent Distribution**
The broadened product boundary for Thanos: a bundled local agent environment that may include productivity/runtime tools, richer virtual filesystems, model routing, memory, review, commit, debug, and protocol integrations in addition to governance. Governance remains a core pillar, but it is no longer the only product boundary.
_Avoid_: Treating every non-governance feature as out of scope

**Team-grade Governance Layer**
The governance pillar inside Thanos: policy, verification, audit, and delegation controls that make local agent use safe and predictable enough for shared team use. "Team-grade" describes adoption pattern and quality bar — each developer runs the Harness locally, but teams share a `harness.policy.json` committed to the project repo. There is no central policy server or multi-tenant runtime; governance is per-developer but coordinated via version-controlled policy.
_Avoid_: Multi-tenant runtime

**Pi**
The installed coding agent CLI — package `@earendil-works/pi-coding-agent` (currently v0.80.2+; keep the repo's devDependency aligned with the installed CLI so the extension typechecks against the runtime API). Loaded via nvm node v24.15.0. Binary at `~/.nvm/versions/node/v24.15.0/bin/pi`.

**Welcome Header**
The startup TUI surface for Thanos. It should orient the user to the current **Agent Distribution** session by showing the active model, thinking level, specialist mode, MCP connectivity, policy/audit posture, recent work, and the commands that answer "what can I do next?".
_Avoid_: Decorative splash screen, stale command cheat sheet, unrelated runtime inventory

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
One of five values: `read | edit | exec | task | interaction`. Maps to Pi and Thanos tools as follows:
- `read` → `read`, `ls`, `find`, `grep` (low-risk except **Sensitive Read** paths)
- `edit` → `write`, `edit`
- `exec` → `bash`
- `task` → `task` subagent delegation
- `interaction` → `ask`, `todo`, `report_finding`

**Interaction Capability**
The `interaction` capability covers governed agent-human or reviewer-state interactions such as `ask`, `todo`, and `report_finding`. It is separate from `task` because these tools do not spawn subagents and should not inherit subagent delegation policy.
_Avoid_: Mapping interaction tools to `task` or `exec`

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
`low | medium | high | critical`. Assigned per tool name before capability rule evaluation, except `bash`, which is tiered by inspecting the command itself: a command whose every clause is a recognized read-only invocation (read-only binary or git read subcommand, no shell metacharacters, no **Sensitive Read** targets) is `low`; anything else — mutating, unknown, redirected, substituted — is `critical` (fail-safe). Low-risk tools (`read`, `ls`, `find`, `grep`) and low-tier bash bypass rule evaluation entirely — always allowed after policy denial checks. High/critical tools always trigger `ask` unless an explicit `allow` rule exists; only `critical` bash triggers the pre-call git snapshot. The builtin sensitive-read patterns are enforced inside the bash tiering because policy sensitive-read rules are `read`-capability and do not match `exec` targets.
_Avoid_: Tiering every bash command `critical` regardless of content; downgrading a command the analyzer cannot prove read-only

**SpecEngine**
Singleton per session. Runs classify → generate → verify lifecycle. `reset()` called at each `before_agent_start`. `verify()` called at `agent_end`.

**SpecTier**
`instant | ambient | explicit`. Instant: no spec generated. Ambient: spec generated silently; drift warnings + verify table shown after run. Explicit: spec shown in TUI for `y/n` approval before execution (only triggered via `--spec` flag, and only for non-instant messages).

**`--spec` flag**
Session-level Pi CLI flag. When set, upgrades `ambient` tier to `explicit`. Never affects `instant` tier — read-only questions always run immediately.

**Specialist**
One of `explore | plan | build | reviewer | designer | oracle | researcher | evaluator | scout | worker`. Each maps to a markdown agent file in `~/.pi/agent/agents/`. Three focused review critics (`reviewer-correctness`, `reviewer-security`, `reviewer-tests`) also ship as agent files for the **Review Jury** but are not in `AGENT_TYPES` — they are invoked by name through the `subagent` tool. The markdown file specifies the system prompt, optional `tools` allowlist, optional `model`, a `maxExecutionTimeMs` budget (the field pi-subagents actually enforces — `timeoutMs` is not a recognized frontmatter field), and optional **Context Mode**. `scout` (fast recon for handoff) and `worker` (fork-context implementer) came with the pi-subagents engine migration. Specialists split into **adversarial/read-only roles** (`explore`, `plan`, `reviewer`, `oracle`, `researcher`) which must run fresh and unbiased, and **continuity roles** (`build`, `designer`) which may opt into forked context. The read-only roles also receive no worktree; only **Writing Agents** do.
_Avoid_: Adding redundant roles (`delegate`, `context-builder`) that duplicate existing specialists

**Oracle**
A read-only, fresh-context specialist that challenges assumptions, audits plans/diffs, and provides an unbiased second opinion without editing or executing. Deny `edit` and `exec` like `explore`/`plan`/`reviewer`. Must never run forked: bias toward prior decisions would defeat its purpose.
_Avoid_: Giving the oracle edit/exec, or running it in forked context

**Subagent**
A separate `pi` subprocess spawned by the `task` tool. Runs in JSON mode (`--mode json`). Receives `HARNESS_SUBAGENT=1` env var so the harness extension does not register the `task` tool inside it (enforces depth limit of 1). Capability ceiling enforced via the `tools` frontmatter field in the agent markdown file. Returns a **Subagent Result Contract**, not free prose. Subagents are researchers, not responders: only the parent agent communicates with the user.
_Avoid_: Child agents talking to the user directly, deep nesting beyond depth 1

**Subagent Result Contract**
The typed structured output every subagent returns to its parent: `{ status, summary, findings[], artifacts[], escalations[], metadata }`. Replaces lossy natural-language summaries with a diffable, auditable handoff schema. Large outputs are written to disk and returned as **Artifact References** rather than inlined, to keep the orchestrator's context lean.
_Avoid_: Free-prose returns, inlining large outputs into the parent context

**Context Mode**
Per-agent context inheritance: `fresh` (isolated `--no-session` context, the default and the only allowed mode for adversarial/read-only roles) or `forked` (inherits the parent session's history via Pi's forked-session feature, sharing its prompt cache). Forked is opt-in and limited to continuity roles. See ADR 0004.
_Avoid_: Forked context for `oracle`/`reviewer`/`explore`; forked as the default

**Governed Clarification**
The governed child→parent escalation channel: when a subagent genuinely needs user input, it raises a typed request through the **Ask Tool** that surfaces to the parent (which owns all user communication), rather than opening a side-channel to the user. Carried in the `escalations[]` field of the **Subagent Result Contract**. Structurally enforced: a subagent process registers neither the `task` nor the `ask` tool, so its only upward channel is its returned contract.
_Avoid_: Raw child-to-user side-channels, ungoverned intercom

**Writing Agent**
A specialist whose policy ceiling permits `edit` — currently `build` and `designer` (the complement of the read-only roles). Writing Agents run in an isolated git **worktree** so their edits never touch the parent's working tree; read-only roles run in `process.cwd()` with no worktree. Derived from a single source of truth (`agentWrites(type)` = not read-only), so adding a future writer role automatically grants it worktree isolation.
_Avoid_: Special-casing `build` for worktrees; giving read-only roles a worktree

**Background Subagent**
A subagent launched with `background: true` that runs detached past the parent's current turn. Instead of blocking the parent, the `task` tool returns an immediate handle and the child writes its finished **Subagent Result Contract** to `.harness/subagents/<id>.result.json`, which the parent polls with its own `read` tool. Foreground (blocking) execution remains the default. See ADR 0005.
_Avoid_: Re-injecting a late result into parent context, a bespoke polling tool, blocking the parent on long writes

**HARNESS_SUBAGENT**
Environment variable set to `"1"` when spawning a subagent subprocess. Causes the harness extension to skip registering the `task` tool, preventing recursive delegation. The depth-1 guard is a deliberate strength, not a limitation: deep nesting is a recognized anti-pattern.

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

- **Thanos** is positioned as an **Agent Distribution** for **Pi**, with **Team-grade Governance Layer** capabilities as its differentiating pillar.
- An **Agent Distribution** may include productivity/runtime tools, protocol integrations, model routing, memory, and virtual filesystems when they improve the local agent workflow.
- A **Team-grade Governance Layer** requires durable **PermissionRule** configuration, auditable **tool_call** decisions, and trustworthy **SpecEngine** verification.
- A **Policy File** is the source of durable team governance, while session approvals only provide temporary exceptions.
- A **Policy File** conforms to a **Policy Schema** before Harness applies any of its rules.
- **Policy-first Teaching Docs** explain **Thanos** through practical governance questions, one mental model at a time.
- A **Sensitive Read** is governed by the **Policy File** before normal low-risk read defaults apply.
- **Sensitive Read Default** is deny-first for known secret patterns, with explicit narrow allow rules for exceptions.
- A **Policy Denial** reports the matched rule, rule source, and remediation path while withholding protected content.
- An **Audit Log** records policy decisions from parent agents, subagents, interactive sessions, and headless runs.
- A **Rule ID** is the join key between **Policy File** rules, **Policy Denial** messages, and **Audit Log** entries.
- **Policy File** rules use first-match-wins evaluation (deterministic, suitable for security invariants). **PermissionManager** session rules use last-match-wins (recency-weighted, so the latest decision overrides earlier ones). The split is intentional: policy is authoritative and predictable; session overrides reflect the most recent user intent.
- **Reviewer** subagents may spawn `explore` subagents at depth 1. All other specialist subagent types (`explore`, `plan`, `build`, `designer`, `oracle`, `researcher`) are leaves and cannot spawn further subagents.
- **Oracle**, **Reviewer**, and `researcher` are adversarial/read-only roles and run fresh-context only; their value depends on being unbiased by the parent's prior decisions.
- A **Writing Agent** (`build`, `designer`) runs in an isolated **worktree**; read-only roles (`explore`, `plan`, `reviewer`, `oracle`, `researcher`) do not. The distinction is derived from the read-only policy list, not hard-coded per role.

**Extension-first Hybrid Strategy**
Thanos should remain Pi-based and prefer extension, slash-command, MCP, policy, installer, and configuration surfaces for new capabilities. Vendoring or forking runtime pieces is allowed only when a target capability is impossible, unsafe, or ergonomically broken through Pi's extension API, and should copy the smallest subsystem needed.
_Avoid_: Wholesale runtime fork, vendoring by default

**Governed Interaction Primitives**
The first Oh-my-pi-inspired capability tranche for Thanos: typed user questions, structured task/todo state, structured review findings, and policy-aware subagent coordination. These primitives should improve how agents ask, plan, report, and delegate under governance rather than adding broad runtime power first.
_Avoid_: Starting with eval/debug/runtime tools before interaction and governance workflows are coherent

**Ask Tool**
A governed interaction primitive that lets the agent ask typed, option-based questions when user input is genuinely required. The tool returns a structured decision record: selected value(s), optional rationale, recommended option, timeout/default behavior, and safe metadata suitable for audit/spec evidence. In headless mode, policy decides behavior: team/CI presets fail closed by default; personal preset may auto-select a recommended option after a configured timeout. Ask v1 is single-question only. Batched form mode is a future extension and must not appear in the tool schema until both interactive and headless behavior are implemented end to end.
_Avoid_: Ad-hoc prose questions, transient UI-only prompts, unstructured decisions that cannot be audited

**Todo Tool**
A governed interaction primitive for phased task state. Todos are grouped into named phases and identified by stable content text, with statuses `pending | in_progress | completed | abandoned`, optional notes, markdown import/export, and completion reminders.
_Avoid_: Silent project-file writes, synthetic task IDs as the only identity, untracked work-in-progress

**Report Finding Tool**
A reviewer-only structured reporting primitive. Findings include priority `P0 | P1 | P2 | P3`, file/line evidence when applicable, summary, rationale, and suggested fix; the review verdict is derived from the collected findings.
_Avoid_: Unstructured review prose that cannot be aggregated or audited

**Evaluator**
A read-only, fresh-context specialist that grades collected implementation evidence against the active contract's acceptance criteria and returns PASS/NEEDS_WORK. It did not do the work, so it is unbiased; it treats every criterion as failing until evidence proves it. Distinct from **Oracle** (which challenges plans/diffs) — Evaluator judges *done-ness* against criteria.
_Avoid_: Letting the builder grade its own work; PASS without evidence

**Default-Fail Contract**
The acceptance-criteria contract the SpecEngine derives for non-instant prompts. Each criterion names the concrete evidence it requires (`diff`, `test`, `command`, or `manual`) and is false until that evidence is collected, so a model cannot self-certify by asserting completion. The loss function the **Completion Verification Gate** enforces.
_Avoid_: Keyword-only criteria a model can satisfy by claiming success

**Completion Verification Gate**
A parent-session `agent_end` gate: when a non-instant spec still has unmet criteria, the harness re-injects the failing criteria as a follow-up turn (`[harness:verify-continue]` sentinel) instead of letting the agent stop. Bounded at three re-injections, preserves the original spec/evidence across continuation turns, disengageable via `THANOS_VERIFY_GATE=off`. See ADR 0006.
_Avoid_: Advisory-only verification the model can ignore; infinite re-injection

**Goal Loop**
A session-scoped `/goal <condition>` self-checking loop. After each turn a fresh, tool-less side-channel `completeSimple` **evaluator** (not a subagent — no agent turn, no re-entrancy) judges the last turn's evidence and returns `MET`/`NOT_MET`; `NOT_MET` auto-continues, `MET` clears. Guarded by turn/token/checkpoint ceilings that PAUSE (never clear). Goal directives carry `[harness:goal-directive]` so they skip spec regeneration, and while a goal is active it is the **sole continuation driver** — the Completion Verification Gate defers (`goalActive`). See ADR 0007.
_Avoid_: A second competing "am I done?" driver firing alongside the gate; false "achieved" on unparseable output

**Review Jury**
The `Ctrl+Shift+R` code review: parallel focused critics (`reviewer-correctness`, `reviewer-security`, `reviewer-tests`) ideally on different model families, plus an `oracle` devil's advocate that runs even when the critics find nothing, plus a synthesis pass that de-duplicates into one verdict. The main agent is the judge and writes no findings itself. Independent cross-family confirmation over a single reviewer.
_Avoid_: A single reviewer's blind spots; the judge authoring its own findings

**WAVES Orchestration**
The `/waves <goal>` bounded parallel workflow: discover the problem shape, decompose into independent slices, fan out bounded parallel workers, verify each structured handoff, synthesize one deliverable. Width and depth are capped; read slices may overlap but write slices must own disjoint paths and run in worktree-isolated writers. Verification of handoffs is the stop function, not a fixed iteration count.
_Avoid_: Unbounded agent spawning; overlapping write slices that corrupt shared state

**Harness Evolution Ledger**
A JSONL record at `.harness/evolution/events.jsonl` of high-signal harness events (gate re-injections, delivery-gate failures, review disagreements, wave-handoff rejections, `goal_*` transitions) plus evidence-backed change manifests. Treats agent failures as harness training data so changes carry a predicted improvement and a later falsification check. Summaries and artifact paths only — never prompts, secrets, or raw tool output. See docs/harness-evolution.md.
_Avoid_: Logging prompts/secrets; harness changes with no failure evidence or follow-up check

## Approved direction

- **Policy and audit**: Audit logs use safe representations by default; policy rules have stable **Rule ID** values; headless mode fails closed; session approvals never create durable policy; Harness ships `personal`, `team`, and `ci` policy presets.
- **Sensitive reads**: Sensitive-read rules apply to `read`, `ls`, `find`, and `grep`; denials reveal the matched policy pattern without exposing protected content; exceptions must be narrow and explicit.
- **Command governance**: Bash commands are governed by command family before pattern matching; destructive commands have built-in denies or explicit-policy requirements; network commands require explicit policy.
- **Spec system**: Specs become structured JSON; verification requires evidence from diffs, command exit codes, tests, or explicit evidence records; unmet criteria warn in interactive mode and fail in CI/headless governance mode; explicit spec approval includes scope, allowed capabilities, and verification plan.
- **Subagents**: Subagents inherit parent policy as a ceiling; each subagent has a capability ceiling; subagents have timeouts and max turns; subagent results include structured metadata; transcripts are retained with policy-safe redaction.
- **Docs**: Documentation starts with concrete risks, uses question-led teaching, provides copy-pasteable JSON examples, separates team policy from personal preference, and explains what happens when policy blocks an action.
- **Integration strategy**: Use an **Extension-first Hybrid Strategy**. Classify borrowed Oh-my-pi capabilities as configure, extend, wrap, vendor, or fork; default to configure/extend/wrap and require explicit trade-off review before vendor/fork.
- **First capability tranche**: Prioritize **Governed Interaction Primitives** before runtime power tools, distribution polish, or external research features.
- **Ask tool semantics**: Implement the **Ask Tool** as a governed decision record, not just a wrapper around `ctx.ui.select` or freeform chat.
- **Ask headless behavior**: Ask follows policy in non-interactive contexts; team/CI fail closed by default, while personal workflows may use configured timeout/default selection.
- **Ask v1 scope**: Ship single-question Ask first; defer batched forms until the whole form contract is implemented.
- **Ask schema**: Use stable option IDs and a shape equivalent to `{ question, options[], recommended, allowOther?, rationale?, timeoutSeconds?, evidenceScope? }`; recommendation is required for headless-eligible asks.
- **Ask privacy and audit**: Audit question text, option IDs, selected IDs, recommendation/default source, and explicitly provided rationale; do not log hidden option metadata or sensitive freeform text without opt-in.
- **Ask permissions**: Classify ask separately from edit/exec; policy may deny questions that request secrets or credentials.
- **Interaction capability**: Governed interaction primitives use a distinct `interaction` capability. `ask`, `todo`, and `report_finding` must be explicitly classified before registration.
- **Todo tool semantics**: Model todos as phased tasks with stable content identity, `pending | in_progress | completed | abandoned` statuses, notes, markdown import/export, and completion reminders.
- **Todo persistence**: Keep todos session-local by default; only write project files through explicit export/import.
- **Review findings**: Add a reviewer-only **Report Finding Tool**; final review verdict aggregates structured P0-P3 findings.
- **Task tool evolution**: Evolve `task` toward typed parallel batches, structured outputs, policy ceilings, artifact references, and reviewer-to-explore delegation; do not permit recursive arbitrary subagents.
- **pi-subagents posture**: Treat the `pi-subagents` npm package as a capability reference to borrow from, not a base to adopt. Keep Thanos's own governed `task` tool and harness as the base, and port specific missing capabilities into it as extensions under the **Extension-first Hybrid Strategy**. Do not replace the governed subagent layer with an enforcement-light framework.
- **Strong subagent system priorities**: The governance spine (fresh-context isolation default, depth-1 guard, scoped tool ceilings) is the best-practice spine, not a tax — keep it. The real upgrades, in priority order: (1) a typed **Subagent Result Contract** for every agent; (2) add the **Oracle** specialist (fresh, read-only); (3) **Governed Clarification** via the Ask Tool (parent owns user comms); (4) **Artifact References** to keep the orchestrator lean at scale; (5) background execution plus worktree isolation for *any* writing agent, not just `build`; (6) a `researcher` specialist, read-only and network-policy-gated, sequenced after the governed interaction primitives.
- **Subagent context mode**: Fresh/isolated context is the default and the only allowed mode for adversarial/read-only roles (`explore`, `plan`, `reviewer`, `oracle`). A `forked` **Context Mode** is opt-in and limited to continuity roles (`build`, `designer`). This partially supersedes ADR 0001 and is recorded in ADR 0004.
- **Governed interaction build order**: Build **Ask Tool**, then **Todo Tool**, then **Report Finding Tool** review flow, then task batching and structured outputs.
- **Distribution**: Keep the bootstrap install UX. By default, the bootstrap resolves and prints the latest stable release version, downloads a versioned release source tarball (`thanos-vX.Y.Z.tar.gz`), and verifies it against a `SHA256SUMS` file published as a GitHub Release asset by release automation after typecheck, lint, and tests pass. Teams can pin with `THANOS_VERSION=vX.Y.Z`. The installer fails closed when neither `sha256sum` nor `shasum -a 256` is available, prints release version, artifact URL, checksum URL, computed checksum, install directory, and Pi version, and may auto-install Pi through the available `bun` or `npm` package manager. Mutable `master`/branch-tip shell installs are too weak for a **Team-grade Governance Layer** trust boundary; signatures can be added later when release key management is mature.
- **Installer verification**: Treat `scripts/install.sh` as a security boundary. Add static validation when available and fixture-driven tests for version resolution, checksum verification, and checksum failure behavior.
- **Build order**: Policy schema and loader, sensitive-read deny rules, policy denial shape, audit log, headless fail-closed behavior, command governance, structured spec generation, evidence-based verification, subagent policy inheritance, then policy-first docs.

## Flagged ambiguities

- "Thanos system" has been resolved as an **Agent Distribution**, not only a **Team-grade Governance Layer**.
- "Governance" remains a first-class pillar, but broader productivity/runtime tools are no longer out of scope when they fit the local agent distribution direction.
- "Integration strategy" has been resolved as **Extension-first Hybrid Strategy**, not a wholesale Oh-my-pi runtime fork.
- "First tranche" has been resolved as **Governed Interaction Primitives**: native ask tool, richer todo, structured review findings, and policy-aware task improvements.
- "Ask tool" has been resolved as a governed decision-record primitive: selections, optional rationale, recommendation/default metadata, and audit/spec evidence.
- "Ask headless behavior" has been resolved as policy-controlled, not always-block or always-default.
- "Ask v1 scope" has been resolved as single-question only; batched forms are deferred until the whole form contract is implemented.
- "Ask schema" has been resolved as stable option IDs with recommendation metadata and optional allowOther/rationale/timeout/evidence fields.
- "Ask privacy" has been resolved as safe audit metadata only unless sensitive freeform logging is explicitly opted in.
- "Ask permissions" has been resolved as a separate governed interaction classification with policy denial for secret/credential requests.
- "Todo tool" has been resolved as phased task state with stable content identity, statuses, notes, markdown import/export, and reminders.
- "Todo persistence" has been resolved as session-local by default, with explicit project-file export/import only.
- "Review findings" has been resolved as reviewer-only structured P0-P3 findings with evidence and aggregate verdict.
- "Task tool evolution" has been resolved as typed batches, structured outputs, policy ceilings, artifacts, and bounded reviewer-to-explore delegation without arbitrary recursion.
- "pi-subagents migration" has been resolved as borrow-and-extend into Thanos's own governed `task` tool, not adopt/replace; pi-subagents is a capability reference only.
- "Strong subagent system" has been resolved as: keep the governance spine, and add typed result contracts, an **Oracle** specialist, governed clarification via Ask, artifact references, background+worktree isolation for writers, and a gated `researcher` — not as a feature-maximalist framework swap.
- "Subagent context isolation" has been resolved as fresh-by-default with an opt-in `forked` mode for continuity roles only (`build`, `designer`); adversarial roles (`explore`, `plan`, `reviewer`, `oracle`) are fresh-only. Recorded in ADR 0004 superseding part of ADR 0001.
- "researcher specialist" has been resolved as in-scope but read-only and network-policy-gated, sequenced after the governed interaction primitives — not rejected, and not ahead of the interaction tranche.
- "background result delivery" has been resolved as **(b) file polling**: a background subagent writes its contract to `.harness/subagents/<id>.result.json` and the parent polls it with `read`, rather than re-injecting a late result into parent context or adding a bespoke polling tool. Recorded in ADR 0005. Foreground blocking execution remains the default; `background: true` is opt-in.
- "worktree isolation scope" has been resolved as **any Writing Agent**, not just `build`: worktree creation is gated on `agentWrites(type)` (the complement of the read-only policy list), so `designer` and any future writer get isolation automatically while read-only roles get none.
- "governed clarification enforcement" has been resolved as **structural, not just conventional**: a subagent process registers neither `task` nor `ask`, so the parent-owns-user-comms invariant cannot be bypassed by a child; escalations are the only upward channel. A `needsClarification(contract)` helper drives deterministic parent-side surfacing.
- "forked spawn feasibility" has been resolved: Pi forks via `--fork <path|id>`, and the parent session id is reachable from extension code via `ctx.sessionManager.getSessionId()`, so forked context is implemented end-to-end (continuity roles only). Session-id access is defensive (`?.`), failing safe to fresh when absent. Known follow-up: a forked run that falls back to fresh (no parent ref) is still recorded as `contextMode: forked` in the transcript — audit fidelity could be improved to mark the effective mode.
- "Governed interaction build order" has been resolved as Ask → Todo → Report Finding/review → Task batching/structured outputs.
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
