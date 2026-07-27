# Thanos — Context

## Glossary

**Thanos**
The Pi config and harness layer living at `~/.pi`. A single-operator agent distribution built around governed local coding workflows.

**Agent Distribution**
A bundled local agent environment that may include governance, model routing, memories, review flows, protocol integrations, and productivity/runtime tools.

**Governance Layer**
The policy, verification, and delegation controls that keep the agent's actions bounded and reviewable by its operator. Governance here protects the operator from the agent; it is not a mechanism for coordinating people.

**Policy File**
A durable JSON configuration source for governance rules over tools, paths, commands, subagents, headless behavior, and sensitive reads.

**SpecEngine**
The session-scoped component that classifies a prompt, generates a spec or task contract, collects evidence, and verifies acceptance criteria.

**Default-Fail Contract**
An acceptance contract where each criterion stays false until matching evidence proves it.

**Task Criterion Source**
The provenance of an acceptance criterion: `deterministic_fallback` for one generated from a keyword template, `semantic_extraction` for one a model derived from the actual request, `user` for one stated outright. Only non-template criteria drive the **Continuation Gate**.

**Continuation Gate**
The `agent_end` check that re-injects a turn when gated acceptance criteria lack evidence. Bounded at three attempts, parent-session only, and stands down while a **Goal Loop** is active.

**Sensitive Read**
A read-like action that targets credentials, tokens, auth material, or other protected paths. Sensitive-read rules win over generic low-risk read defaults.

**Governed Tool Call**
The normalized representation of a tool call before execution: tool, safe target, capability, risk tier, matching rule, and audit target.

**Specialist**
One of `explore | plan | build | reviewer | designer | oracle | researcher | evaluator | scout | worker`, each mapped to an agent markdown definition and a catalog profile.

**Writing Agent**
A specialist with edit authority, currently `build` and `designer`. Writing agents run in isolated worktrees.

**Subagent**
A bounded `pi` subprocess delegated by the parent agent under a narrowed capability ceiling.

**Subagent Result Contract**
The structured return format every subagent must produce: `{ status, summary, findings[], artifacts[], escalations[], metadata }`.

**Context Mode**
Per-agent inheritance mode: `fresh` for isolated context, `forked` for continuity roles that intentionally inherit parent session history.

**Goal Loop**
A session-scoped `/goal <condition>` continuation loop where the agent keeps working until it signals completion and a fresh evaluator confirms the evidence.

**MCP Trust Decision**
Whether a configured MCP server may be connected, based on where its config came from. A server the operator configured is trusted; one supplied by the open project is refused until explicitly approved, because for a stdio server the config names a command that gets spawned.

**Harness Evolution Ledger**
The JSONL log of high-signal harness events and evidence-backed follow-up changes under `.harness/evolution/events.jsonl`.

## Relationships

- Thanos is an **Agent Distribution** for **Pi** with a **Governance Layer**.
- The **Policy File** is the durable source of governance; session approvals are temporary.
- The **SpecEngine** produces a **Default-Fail Contract** and verifies it from evidence.
- A criterion's **Task Criterion Source** decides whether the **Continuation Gate** may act on it.
- A **Sensitive Read** is governed before low-risk read defaults apply.
- A **Specialist** may run as a **Subagent** under a narrowed ceiling.
- A **Writing Agent** gets worktree isolation; read-only roles do not.
- Every **Subagent** returns a **Subagent Result Contract**.
- An **MCP Trust Decision** is made before a server's client is constructed, because constructing it is what launches the server.
- The **Goal Loop** is a governed workflow driver. `/waves` and `Ctrl+Shift+R` are prompt conventions: they compose a prompt and send it, with no runtime enforcing slices, write ownership, or critic collection.

## Read More

- `AGENTS.md` — operational rules and re-entry workflow for coding agents
- `docs/architecture/prompt-system.md` — deeper prompt-system architecture and phase map
