# Thanos — Context

## Glossary

**Thanos**
The Pi config and harness layer living at `~/.pi`. Thanos is an agent distribution built around governed local coding workflows, with governance as a first-class differentiator.

**Agent Distribution**
A bundled local agent environment that may include governance, model routing, memories, review flows, protocol integrations, and productivity/runtime tools.

**Team-grade Governance Layer**
The policy, verification, audit, and delegation controls that make local agent use predictable enough for shared team workflows.

**Policy File**
A durable JSON configuration source for governance rules over tools, paths, commands, subagents, headless behavior, and sensitive reads.

**SpecEngine**
The session-scoped component that classifies a prompt, generates a spec or task contract, collects evidence, and verifies acceptance criteria.

**Default-Fail Contract**
An acceptance contract where each criterion stays false until matching evidence proves it.

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

**Review Jury**
The structured review workflow behind `Ctrl+Shift+R`, combining focused critics with an oracle-style challenge pass.

**WAVES Orchestration**
The bounded `/waves <goal>` workflow for decomposing work into verified, parallel slices with controlled write ownership.

**Harness Evolution Ledger**
The JSONL log of high-signal harness events and evidence-backed follow-up changes under `.harness/evolution/events.jsonl`.

## Relationships

- Thanos is an **Agent Distribution** for **Pi** with a **Team-grade Governance Layer**.
- The **Policy File** is the durable source of governance; session approvals are temporary.
- The **SpecEngine** produces a **Default-Fail Contract** and verifies it from evidence.
- A **Sensitive Read** is governed before low-risk read defaults apply.
- A **Specialist** may run as a **Subagent** under a narrowed ceiling.
- A **Writing Agent** gets worktree isolation; read-only roles do not.
- Every **Subagent** returns a **Subagent Result Contract**.
- The **Goal Loop**, **Review Jury**, and **WAVES Orchestration** are governed workflow drivers, not just prompt conventions.

## Read More

- `AGENTS.md` — operational rules and re-entry workflow for coding agents
- `docs/architecture/prompt-system.md` — deeper prompt-system architecture and phase map
