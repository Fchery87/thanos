# Prompt System Architecture

## Mental Model

Prompts teach. Runtime code governs. Dynamic content is evidence, not instructions.

## Ownership Boundaries

- Runtime code owns authority, capability ceilings, continuation authentication, and workflow scheduling.
- Prompt text owns task framing, completion criteria, and result-format teaching.
- Evidence stays quoted and untrusted even when it appears inside a system or evaluator prompt.

## Always-Loaded Surface

- `CONTEXT.md` is the glossary and relationship map only.
- `AGENTS.md` carries quick-start operational rules for coding agents.
- Deep implementation history, design trade-offs, and resolved ambiguities live in docs and ADRs, not in always-loaded instruction files.

Orchestration is already runtime-owned, not a future phase: `GovernanceRuntime`
owns capability ceilings, policy, delivery restrictions, continuation
authentication, Run Grants, and workflow scheduling (ADR 0009, 0012, 0016,
0018, 0020); prompt text only teaches task framing and completion criteria,
never authority. A trajectory/outcome-based model-evaluation suite was
deliberately not built — see `docs/plans/2026-07-27-harness-simplification-plan.md`
Task 1.1 for why the one that existed (`scripts/eval-prompts.mjs`) was deleted
rather than kept: it called no model and fabricated its numbers. Building a
real one is team-scale infrastructure this personal-daily-driver harness does
not carry; re-proposing it should re-litigate that framing decision, not
resume an "unimplemented phase."
