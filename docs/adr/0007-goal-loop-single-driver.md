# ADR 0007 — `/goal` self-checking loop with a single continuation driver

**Status:** Accepted

## Context

Thanos already had a completion verification gate (ADR 0006) that re-injects unmet spec criteria at `agent_end`. The market (`/goal` in Claude Code, follow-goals in Codex) converged on a complementary primitive: turn a prompt into a durable objective that a fast evaluator checks after every turn, auto-continuing until met.

Adding this to Thanos raised a specific hazard: `/goal` and the ADR 0006 gate both hook `agent_end` and both continue the session via `pi.sendUserMessage(..., { deliverAs: "followUp" })`. Naively, they would (a) both queue a follow-up in the same turn, and (b) the gate's `before_agent_start` handler would regenerate a fresh spec from each goal-directive prompt, wiping the collected evidence every goal turn.

## Decision

Add a session-scoped `/goal` command with a guarded auto-loop, and make the two continuation mechanisms mutually exclusive:

1. The evaluator is a **side-channel `completeSimple` call** (fresh, tool-less, one-shot) — not a subagent. It consumes no agent turn, so there is no re-entrancy; the only agent turns are the work turns.
2. The evaluator judges the **last turn's evidence only** (assistant text + that turn's tool results), extracted from the `agent_end` messages. Claims without tool evidence are `NOT_MET`. Unparseable output is `NOT_MET` (fail-safe).
3. Every goal-injected message carries `GOAL_DIRECTIVE_SENTINEL`. `before_agent_start` skips spec regeneration for it (as it already does for the gate's `GATE_CONTINUE_SENTINEL`), so a goal turn never wipes the active spec/evidence.
4. `shouldReinject` takes a `goalActive` input and returns false while a goal is active. **While a goal is active, the goal evaluator is the sole continuation driver; the gate defers.** At most one follow-up is queued per `agent_end`.
5. Ceilings (`maxTurns`, `maxTokens`, `checkpointEvery`) and errors **pause** the goal (resumable), never clear it. `maxTokens` is a cumulative, clamped context-growth guard, not a spend cap (compaction shrinks context, so a raw delta could go negative and never fire).
6. The loop is parent-session only, trust-gated, and records `goal_set` / `goal_achieved` / `goal_paused` to the harness evolution ledger (ADR-adjacent to M7).

## Consequences

- Users get durable, self-verifying objectives without a second, competing "am I done?" mechanism firing alongside the spec gate.
- The sentinel and the `goalActive` guard are load-bearing: both must stay in sync with the ADR 0006 gate. A live run where both the gate and the goal loop queue a follow-up in one turn is a regression against this decision.
- The evaluator's usefulness depends on tool-result extraction. If evidence is not surfaced in the last turn, the fail-safe returns `NOT_MET`, which can cause extra turns rather than a false completion — the safe failure direction.
- Cross-session restore of an active goal is **deferred**: the extension API exposes `appendEntry` for writing but no confirmed read-back of custom entries on `--resume`. The pure `serializeGoal` / `restoreController` helpers are implemented and tested, ready to wire when that read path is confirmed.
- The token ceiling is a growth guard, so `maxTurns` remains the primary budget; this is documented in the README and settings comments to avoid implying a spend guarantee.

Supersedes the standalone design in `docs/plans/2026-07-01-goal-command-design.md` and its plan; the merged, review-amended plan is `docs/plans/2026-07-02-harness-fixes-and-goal-command.md`.
