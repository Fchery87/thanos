# ADR 0004 — Opt-in forked context for continuity roles

**Status:** Accepted (partially supersedes ADR 0001)

## Context

ADR 0001 chose subprocess-spawned subagents running in fresh, isolated context (`--mode json`, effectively `--no-session`) for true context isolation, and recorded as a consequence that a subagent "cannot pass in-memory state" from the parent. That decision is still correct as the **default**.

Since then, Pi/Claude-style runtimes shipped a **forked subagent** mode: the child inherits the parent session's full conversation history up to the fork point and shares the parent's prompt cache, so re-sending the inherited tokens is cheap. Current best-practice research is consistent on the trade-off:

- **Fresh context** → unbiased, clean, cheaper in absolute tokens, and the right choice for adversarial/read-only work (exploration, review, second opinions).
- **Forked context** → carries the parent's decisions and bias, which *helps* multi-step continuity work (iterative design, long build sequences) but *hurts* audit/review quality because the child defers to prior decisions.

A naive reading of "forking is a newer, richer feature" would push us to fork everywhere. That would degrade exactly the roles whose value is independence.

## Decision

Add `forked` as an opt-in **Context Mode**, scoped by role:

- **Adversarial / read-only roles — fresh only:** `explore`, `plan`, `reviewer`, `oracle`. These may never run forked.
- **Continuity roles — may opt into forked:** `build`, `designer`. Fresh remains the default even for these; forked is selected explicitly per agent definition.

This partially supersedes ADR 0001: fresh isolation is still the default and the only mode for adversarial roles; forked is a deliberate, narrow exception for continuity.

## Reasoning

- **Protects the roles that depend on independence.** An oracle or reviewer that inherits and defers to the parent's reasoning is worth less, not more.
- **Captures the genuine win.** Continuity roles benefit from inherited context, and the shared prompt cache makes the inheritance affordable — addressing ADR 0001's "cannot pass in-memory state" cost for the cases where that state actually helps.
- **Keeps the governance spine intact.** Depth-1 guards, scoped tool ceilings, policy inheritance, and audit are unchanged. Context mode is orthogonal to capability ceiling.
- **Default stays safe.** Because fresh is still the default, an agent only gets forked context when its definition explicitly asks for it.

## Consequences

- Agent definitions gain an optional `context: fresh | forked` field; absence means `fresh`.
- The harness must refuse `forked` for adversarial roles (validation error, not silent downgrade).
- Forked spawns must still flow through policy ceiling narrowing and audit logging; inheriting context must not inherit a *wider* capability ceiling than the parent grants the child.
- Transcripts/audit should record which context mode each subagent ran in, since it affects how to interpret the child's output.
