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

## Amendments (2026-07-05)

Field experience (a real goal hitting the 25-turn ceiling) exposed three gaps; all are now implemented:

1. **Ceilings are windows, rebased on resume.** Originally `turnsEvaluated >= maxTurns` was a lifetime check, so resuming a ceiling pause granted exactly **one** turn before re-pausing (turn 26 ≥ 25). The controller now tracks `turnsBase`/`tokensBase` and ceilings fire on growth **since the last resume**, so `/goal resume` grants a fresh full window. Same fix applies to the token-growth ceiling.
2. **Resume re-kicks the loop.** `resume` only flipped status; since the loop advances solely on `agent_end`, nothing happened until the user typed something. The command now queues a continuation directive (with the last `NOT_MET` reason) itself.
3. **The evidence contract is explicit in directives.** The evaluator's blindness (last message + last tool outputs only) is deliberate and unchanged, but the worker was not told how it is judged, so real progress that went unsurfaced burned ceiling turns on `NOT_MET`. Every directive now states the verification model and requires ending each reply with concrete evidence.
4. **`evaluatorRole` is wired.** The settings knob existed but the wiring always used the session model. The evaluator now resolves its model from the role's **active** `subagents.agentOverrides` entry (the same key pi-subagents applies, honoring the same on/off toggle), walking primary then fallbacks with registry+auth checks, and falls back to the session model when routing is off or nothing resolves. Settings are re-read per evaluation so toggling takes effect mid-session.

## Amendment (2026-07-05) — evaluator becomes a completion *confirmer*, not a per-turn judge

Field experience surfaced two fragilities in the per-turn design: (a) because the evaluator ran on **every** `agent_end`, any evaluator/provider error paused the whole goal (`eval-error`), and (b) a tool-less judge reading only the last turn could misread progress, spending ceiling turns on `NOT_MET` or, worse, closing on a premature `MET`. Both stem from the loop deciding completion *for* the agent every turn.

The loop now separates the two concerns:

1. **Per-turn (`GoalController.onTurnEnd`)** advances the turn/token counters and fires the ceilings, then emits an unconditional continuation directive (`buildContinueDirective`). It calls **no** evaluator, so an ordinary work turn can no longer be paused by a checker error.
2. **Completion (`goal_complete` tool → `GoalController.confirmComplete`)** is agent-signaled: the agent calls `goal_complete` with a summary and evidence when it believes the goal is met. The tool runs the **same** evaluator (routed via the subagents toggle, else the session model) against the last turn's real evidence to **confirm**. `MET` → achieved (turn terminates); `NOT_MET` → the goal stays active and the reason is returned so the agent keeps working. A confirmation error **fails safe to `NOT_MET`** (retry once on the session model first) and never pauses the goal.

Consequences and invariants:

- **Single-driver is preserved.** The goal loop remains the sole continuation driver while active (the ADR 0006 gate still defers via `goalActive`); at most one follow-up per `agent_end`. Achievement now happens inside the tool, so by the time that turn ends the goal is non-active and `handleAgentEnd` no-ops — no double drive.
- **Completion now requires the agent to call `goal_complete`.** The always-injected goal system prompt and every directive instruct this. If the agent stops without calling it, the loop simply re-prompts until it does or a ceiling pauses — the safe direction (never a false close).
- **`maxTurns` counts work turns**, not evaluator passes; the (resumable) ceilings are unchanged. The token-growth guard is unchanged.
- The `goal_complete` tool is parent-session only and rejects when no goal is active.
