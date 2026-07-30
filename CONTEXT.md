# Thanos — Context

## Glossary

**Thanos**
The Pi config and harness layer living at `~/.pi`. A single-operator agent distribution built around governed local coding workflows.

**Agent Distribution**
A bundled local agent environment that may include governance, model routing, memories, review flows, protocol integrations, and productivity/runtime tools.

**Governance Layer**
The policy, verification, and delegation controls that keep the agent's actions bounded and reviewable by its operator. Governance here protects the operator from the agent; it is not a mechanism for coordinating people.

**Delegation Authority**
The one runtime allowed to discover specialists, launch child agents, enforce child execution contracts, and own their lifecycle. Thanos uses `pi-subagents` as its Delegation Authority; Thanos may constrain, request, and observe delegation, but does not maintain a second executor.

**Recovery Authority**
The runtime that owns retry, backoff, authentication refresh, and context-overflow recovery for one execution level. Pi owns parent recovery and the Delegation Authority owns child recovery; Enforced Workflows observe these outcomes but never create a competing retry loop.

**Compatibility Gate**
An executable contract suite that an exact external runtime version must pass before Thanos supports installing or upgrading to it.

**Emergency Compatibility Patch**
A bounded, version-specific source modification for a verified upstream defect. It is temporary ownership with an explicit removal condition, not a permanent Thanos feature.

**Policy File**
A durable JSON configuration source for governance rules over tools, paths, commands, subagents, headless behavior, and sensitive reads.

**Work Contract**
The immutable, operator-approved revision of a mutating task: objective, workflow plan, capability ceiling, canonical target roots, delivery and egress boundary, acceptance criteria, and any bounded dynamic expansion templates. It is owned by the SpecEngine and enforced by Governance.

**Run Grant**
Process-local authority to execute one approved Work Contract in one workflow run. It may survive an in-process pause, but never a process restart, repository drift, or contract revision.

**Repository Baseline**
The fail-closed identity and state of the checkout against which a Run Grant was approved, including committed, indexed, working-tree, untracked, and symlink state.

**Awaiting Verification**
A non-complete workflow state in which isolated mutations are ready for attended validation but have not earned operator-task completion.

**Paused Workflow**
A non-terminal Enforced Workflow that owns no continuation and cannot launch new work until explicitly resumed. An in-process resume may reuse unchanged approval; a reload, repository drift, or contract revision requires fresh approval and a new Run Grant.

**Cancelled Workflow**
A terminal Enforced Workflow whose active delegations have been aborted, Run Grant revoked, and continuation ownership released. Cancellation never rewinds filesystem effects; any surviving working-tree changes become ordinary operator-owned state, and another attempt requires a new workflow identity and approval.

**Workflow Handoff**
An explicit context rotation that terminates the source Enforced Workflow and creates a lineage-linked, paused workflow with a new identity in a fresh Pi session. Intent and accepted evidence references transfer; active delegations, continuation ownership, and the Run Grant do not.

**Goal-Attached Workflow**
An Enforced Workflow that executes the existing nonterminal Goal Intent and Work Contract. It temporarily owns continuation while the Goal Loop retains intent and accounting but queues no turns. It is created explicitly with `/waves goal`; unrelated standalone workflows cannot replace a nonterminal goal.

**SpecEngine**
The session-scoped component that classifies a prompt, generates a spec or task contract, collects evidence, and verifies acceptance criteria.

**Default-Fail Contract**
An acceptance contract where each criterion stays false until matching evidence proves it.

**Task Criterion Source**
The provenance of an acceptance criterion: `deterministic_fallback` for one generated from a keyword template, `semantic_extraction` for one a model derived from the actual request, `user` for one stated outright. Before Work Contract approval, only non-template criteria drive continuation; approval makes the accepted criteria binding regardless of their original source.

**Continuation Gate**
The operator-task acceptance check at `agent_end` that returns unmet binding criteria to the active continuation driver. Ordinary turns use a bounded retry budget; Goal Loops use their own ceilings.

**Continuation Driver**
The one runtime currently allowed to queue the next parent turn. Ownership is exclusive: an active Enforced Workflow supersedes Goal Loop, which supersedes the ordinary Spec continuation path.

**Sensitive Read**
A read-like action that targets credentials, tokens, auth material, or other protected paths. Sensitive-read rules win over generic low-risk read defaults.

**Governed Tool Call**
The normalized representation of a tool call before execution: tool, safe target, capability, risk tier, matching rule, and audit target.

**Specialist**
An agent definition resolved by the Delegation Authority for a bounded kind of work. Its name is routing metadata and grants no authority; the live launch contract is authoritative.

**Effective Capability Ceiling**
The monotonic intersection of all limits placed on a child run. It is the maximum authority the child may receive regardless of its Specialist name or requested tools.

**Writing Agent**
A specialist whose effective launch contract grants mutation tools. Parallel writers require explicit worktree isolation; ordinary workflows keep one writer in a checkout.

**Integration Owner**
The main-session writer that alone may mutate the target checkout during an Enforced Workflow. It integrates accepted child evidence under the workflow's Work Contract and Run Grant; no delegated node writes or merges.

**Integration Contract**
The parent-owned portion of a workflow's Work Contract that fixes the Integration Owner's target roots, capability ceiling, acceptance criteria, Integration Turn Budget, and Jury Round Budget. Delegated workflow nodes never contribute mutation authority.

**Subagent**
A bounded child run launched by the Delegation Authority under its resolved launch contract and capability ceiling.

**Subagent Result Contract**
The execution, review, effects, acceptance, and artifact evidence returned by the Delegation Authority for a child run.

**Delegation Evidence Envelope**
The public, versioned Delegation Authority response that binds a child result to its owner run, workflow node, request, executed launch contract, acceptance evidence, review, effects, artifacts, usage, warnings, and residual risks. Missing or mismatched required evidence leaves a workflow node Awaiting Verification.

**Context Mode**
Per-agent inheritance mode resolved by the Delegation Authority: `fresh` for isolated context and `fork` for a child that intentionally inherits parent session history.

**Enforced Workflow**
A named, operator-invoked workflow whose graph, delegation calls, gates, and terminal outcome are executed and recorded by code. A prompt that merely asks the model to follow a process is a prompt convention, not an Enforced Workflow.

**Workflow Journal**
The branch-local, append-only sequence of Pi session entries from which an Enforced Workflow reconstructs its durable progress. It records intent and evidence references, never a Run Grant or other mutation authority.

**Completion Authority**
The component allowed to declare work complete at one level of the system. The Delegation Authority owns child-node acceptance, an Enforced Workflow owns graph completion, and the SpecEngine owns operator-task acceptance. Evidence may move upward; completion authority does not.

**Completion Claim**
An agent assertion that the active Work Contract is satisfied and ready for acceptance. It requests verification but carries no completion authority.

**Workflow Yield**
The Integration Owner's revision-bound assertion that its current workflow phase is ready for evidence settlement. It advances nothing by itself and becomes stale when later effects change the evidence being judged.

**Repository Revision Identity**
The fail-closed pairing of repository `HEAD` and bounded working-tree identity used to bind a Workflow Yield to the exact state reviewed by the jury. If it changes or cannot be established, the yield is not fresh.

**Jury Verdict**
A schema-validated delegated review result with exactly one terminal disposition: `APPROVE` or `REQUEST_CHANGES`. Warnings are non-blocking metadata; every blocking finding identifies its evidence, affected path, and required correction. A Jury Verdict supplies evidence to the SpecEngine but never owns operator-task completion.

**Jury Round Budget**
The Work Contract's immutable ceiling on structured Jury Verdict attempts. The default is three total rounds: the initial review and at most two correction reviews. Exhaustion pauses the workflow; only an approved contract revision may increase the ceiling.

**Integration Turn Budget**
The Work Contract's immutable ceiling on completed parent turns owned by an Enforced Workflow. The default is twelve turns across initial integration and all correction rounds. Aborted turns do not consume it; exhaustion pauses the workflow, and resume does not reset it.

**Evidence Provenance**
The identity of the run, node, actor, command, artifact, or repository state that produced an acceptance claim. Higher-level completion requires provenance-preserving evidence rather than an unbound success summary.

**Goal Loop**
A session-scoped continuation driver for Goal Intent. It keeps an accepted Work Contract moving but cannot decide that the operator task is complete.

**Goal Intent**
The durable statement of what an operator wants a Goal Loop to accomplish. It may survive process restart, but carries no Run Grant or mutation authority.

**MCP Trust Decision**
Whether a configured MCP server may be connected, based on where its config came from. A server the operator configured is trusted; one supplied by the open project is refused until explicitly approved, because for a stdio server the config names a command that gets spawned.

**Harness Evolution Ledger**
The JSONL log of high-signal harness events and evidence-backed follow-up changes under `.harness/evolution/events.jsonl`.

## Relationships

- Thanos is an **Agent Distribution** for **Pi** with a **Governance Layer**.
- The **Policy File** is the durable source of governance; session approvals are temporary.
- Every supported **Delegation Authority** version passes the **Compatibility Gate**.
- An **Emergency Compatibility Patch** may bridge a failed **Compatibility Gate** only until a verified upstream release passes it unmodified.
- The **SpecEngine** is the single approval authority for a **Work Contract**; Governance enforces the approved revision and keeps immutable policy denials and operation-specific critical gates.
- A bounded dynamic-fanout template belongs to the approved **Work Contract**. Materializing children within its declared bound does not expand the contract; changing its agent, template, source, or bound does.
- Approving a **Work Contract** creates one process-local **Run Grant** bound to its **Repository Baseline**; restoring intent never restores authority.
- An unattended mutating run may reach **Awaiting Verification**, but only attended validation can advance it to completion.
- The **SpecEngine** produces a **Default-Fail Contract** and verifies it from evidence.
- A criterion's **Task Criterion Source** decides whether the **Continuation Gate** may act on it.
- Exactly one **Continuation Driver** may queue work: an active **Enforced Workflow** first, then an active **Goal Loop**, then the ordinary spec path.
- A **Completion Claim** is decided only after repository and workflow evidence has reached the SpecEngine; qualitative evaluation cannot override missing deterministic evidence.
- A **Workflow Yield** may request phase verification, but only settled evidence can advance an **Enforced Workflow**.
- A **Workflow Yield** remains fresh only while its **Repository Revision Identity** is unchanged; read-only validation after yielding does not stale it by itself.
- A `REQUEST_CHANGES` **Jury Verdict** returns work to the same **Integration Owner** for a new revision, yield, and jury attempt; an `APPROVE` verdict remains evidence subject to **SpecEngine** acceptance.
- `/waves resume` preserves the consumed **Jury Round Budget**; it cannot silently reset an approved ceiling.
- An **Enforced Workflow** preserves its consumed **Integration Turn Budget** across pauses and resumes; only an approved contract revision may increase the ceiling.
- Interrupting an **Enforced Workflow** creates a **Paused Workflow**, aborts active delegation, and consumes no turn or jury budget; explicit cancellation instead creates a terminal **Cancelled Workflow**.
- A **Sensitive Read** is governed before low-risk read defaults apply.
- A **Specialist** may run as a **Subagent** only through the **Delegation Authority**.
- A **Specialist** receives no authority from its name; its **Effective Capability Ceiling** bounds the live launch contract.
- An **Enforced Workflow** keeps mutation in its main-session **Integration Owner**; delegated workflow nodes are read-only.
- The **SpecEngine** derives the Run Grant for an **Enforced Workflow** solely from its **Integration Contract**, never from delegated-node metadata.
- Every **Subagent** returns a **Subagent Result Contract**.
- An Enforced Workflow consumes only a complete, identity-matched **Delegation Evidence Envelope**; transport success alone cannot complete a node.
- An **MCP Trust Decision** is made before a server's client is constructed, because constructing it is what launches the server.
- The **Goal Loop** is a continuation driver, not a **Completion Authority**.
- `/waves` launches an **Enforced Workflow** whose code-owned plan, dependency gates, parent write ownership, and accepted V2 evidence are recorded by the SpecEngine.
- `Ctrl+Shift+R` runs the same code-owned structured jury DAG as a standalone review; it does not create a Workflow Journal or accept the operator task.
- An **Enforced Workflow** reconstructs only the active branch of its **Workflow Journal**; abandoned session branches cannot revive workflow progress.
- A **Workflow Journal** may survive reload, fork, or handoff, but the associated **Run Grant** never does.
- A failed required node creates a **Paused Workflow**; resuming creates a fresh child attempt identity rather than replaying the settled attempt.
- Cancelling an **Enforced Workflow** aborts active children and authority, not filesystem history; a **Cancelled Workflow** cannot be resumed.
- Ordinary session switching, forking, and tree navigation are blocked while an **Enforced Workflow** is active; a **Workflow Handoff** is the only supported transfer and always requires fresh approval before mutation resumes.
- A **Goal-Attached Workflow** reuses the goal's **Work Contract** instead of creating a competing spec; when it stops owning continuation, control returns to the **Goal Loop**.
- Completing a **Goal-Attached Workflow** requires both a revision-ready **Workflow Yield** and a goal-level **Completion Claim**; the **SpecEngine** decides both from the same settled evidence.
- An **Enforced Workflow** defers to the applicable **Recovery Authority** while it is retrying or compacting and pauses only after that authority reports terminal failure.
- Delegated workflow nodes are read-only until the public V2 contract can carry and verify the exact parent-approved **Run Grant**; mutation remains parent-owned and a mutating plan fails before launch.
- Named orchestration and review controls are **Enforced Workflows**; the superseded prompt-only implementations are removed rather than retained beside them.
- **Completion Authority** is hierarchical: child acceptance feeds workflow acceptance, which feeds the operator-task gate. No child can directly close its parent task.
- Persisting **Goal Intent** never persists a **Run Grant**. Re-entry restores intent paused; mutating work resumes only after a fresh Work Contract approval and Repository Baseline.

## Read More

- `AGENTS.md` — operational rules and re-entry workflow for coding agents
- `docs/architecture/prompt-system.md` — deeper prompt-system architecture and phase map
