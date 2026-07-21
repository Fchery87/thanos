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

## Remaining Phase Map

- Phase 7: make orchestration runtime-owned.
- Phase 8: prune always-loaded instructions and standardize prompt writing.
- Phase 9: evaluate prompt behavior with outcome- and trajectory-based cases.
