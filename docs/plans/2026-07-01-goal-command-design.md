# Design: `/goal` command for pi (self-checking autonomous loop)

Date: 2026-07-01
Status: SUPERSEDED by docs/plans/2026-07-02-harness-fixes-and-goal-command.md (implemented 2026-07-02, with four review fixes: gate coordination, mandatory tool-result extraction, paused-state persistence, clamped token accounting). Retained for design history.

## 1. What we're replicating

`/goal` in Claude Code (v2.1.139+) and Codex (v0.128.0+) turns a normal prompt
into a **durable, self-checking objective**:

- `/goal <condition>` sets a completion condition and **immediately starts a
  turn** with the condition as the directive.
- After **each turn finishes**, a **small fast model (evaluator)** reads the
  condition + conversation and returns **yes/no + a one-line reason**.
- **"No" → auto-start another turn**, feeding the reason as guidance.
  **"Yes" → clear the goal automatically** and record an "achieved" entry.
- `/goal` (no arg) → status; `/goal clear` cancels (aliases
  `stop｜off｜reset｜none｜cancel`); Codex adds `pause`/`resume`.
- Session-scoped, one goal at a time. Under the hood: *"a wrapper around a
  session-scoped prompt-based Stop hook"* that calls the small fast model.
- Condition ≤ 4000 chars.

Sources: https://code.claude.com/docs/en/goal ·
https://developers.openai.com/codex/use-cases/follow-goals

## 2. Codebase primitives (all confirmed present)

| Need | pi primitive | Evidence |
| --- | --- | --- |
| Turn boundary (Stop-hook equiv.) | `pi.on("agent_end")` — carries `messages`, `willRetry` | `types.d.ts:515`, `agent-session.d.ts:40` |
| Continue the loop | `pi.sendUserMessage(dir, { deliverAs: "followUp" })` | proven in `src/index.ts:1229,1246` |
| **Side-channel evaluator** | `completeSimple(model, { systemPrompt, messages })` → `Promise<AssistantMessage>` | `pi-ai/dist/compat.d.ts:64` |
| Pick evaluator model | `evaluator` role in model-routing | `src/agents/model-routing.ts:54` |
| Token accounting | `ctx.getContextUsage()` | `types.d.ts` |
| Status panels | `formatPanel` | `src/ui-utils` |
| Trust gate | `ctx.isProjectTrusted()` | `types.d.ts:1130` |
| Persist across resume | `appendEntry` custom entry | `ExtensionActions` |

**Key architectural decision (resolved by codebase):** the evaluator is a
**side-channel `completeSimple` call** — a fresh, tool-less, one-shot completion.
It does **not** spawn a subagent and does **not** consume an agent turn, so there
is **no re-entrancy**: the only agent turns are the work turns. This is exactly
how the real `/goal` Stop-hook works.

## 3. Resolved decisions

- **Autonomy (Q1):** Guarded auto-loop. Auto-continues like real `/goal`, but a
  `maxTurns` ceiling (**default 25**) and optional token ceiling / checkpoint.
  **Hitting a ceiling PAUSES (resumable), never clears.**
- **Fire event (Q2):** `agent_end`; **skip when `willRetry === true`** or
  `isSubagent`.
- **Continue (Q3):** `sendUserMessage(directive, { deliverAs: "followUp" })`.
- **Evaluator model (Q4):** `evaluator` role override if set, else current
  session model at `reasoning: "low"`.
- **Evaluator input (Q5):** **last work turn only** — condition + last
  assistant message + its tool results + previous evaluator reason. Not full
  history (cost/latency/determinism).
- **Verdict protocol (Q7):** evaluator must reply
  `VERDICT: MET|NOT_MET` / `REASON: <one line>`. Parse case-insensitively;
  **unparseable → NOT_MET** (fail-safe: never a false "done").
- **Directive (Q6):** condition + `"Not yet met: <reason>. Continue toward it;
  when met, surface the evidence (test output, git status, counts) in your
  reply so it can be verified."`
- **Commands (Q8):** `/goal <cond>` · `/goal` · `/goal clear`
  (`stop off reset none cancel`) · `/goal pause` · `/goal resume`; `/clear`
  drops the goal.
- **Cross-session resume (Q9):** restore an **active** goal on
  `--resume`/`--continue` via a persisted custom entry; reset turn/timer/token
  baseline; don't restore achieved/cleared.
- **Status/indicator (Q10):** widget `◎ /goal active — N turns · ~Ktok`;
  `/goal` no-arg → `formatPanel` (condition, elapsed, turns, tokens, last
  reason); show last-achieved if none active.
- **Permissions (Q11):** orthogonal — never bypass prompts; a tool needing
  approval pauses the loop until answered. One-time hint on goal-set if not in
  auto mode.
- **Failures (Q12):** work-turn error → don't count the turn, surface, pause.
  Evaluator call throws/times out → retry once, then pause with notice. Never
  silently stop or continue.
- **Trust gate (Q13):** refuse (with reason) when project untrusted.
- **Validation (Q14):** ≤4000 chars, non-empty, main-session only, one active
  goal (new replaces with notice).

## 4. State machine (session-scoped singleton)

```
            /goal <cond>
  (none) ─────────────────▶ ACTIVE ──agent_end(!willRetry)──▶ evaluate (completeSimple)
                              ▲                                     │
              /goal resume    │                        NOT_MET & budget left
                              │                                     │
   PAUSED ◀──/goal pause──── ACTIVE ◀───sendUserMessage(followUp)───┘
                              │
                     MET ─────┴──────▶ ACHIEVED (clear + record entry)
                     ceiling / checkpoint ─▶ PAUSED (await /goal resume)
                     work error / eval error ─▶ PAUSED (surface)
                     /goal clear | /clear ────▶ (none)
```

```ts
interface GoalState {
  condition: string;
  status: "active" | "paused" | "achieved";
  startedAt: number;
  turnsEvaluated: number;
  tokensAtStart: number;
  lastReason?: string;
  achieved?: { at: number; reason: string; turns: number };
}
```

## 5. Settings (`goal`, all optional)

```jsonc
"goal": {
  "maxTurns": 25,           // pause on hit (0 = unlimited / full-auto)
  "maxTokens": 0,           // 0 = off
  "checkpointEvery": 0,     // 0 = off; N = pause-to-confirm every N turns
  "evaluatorRole": "evaluator"
}
```

## 6. Files & wiring

- **New** `src/goal/state.ts` — `GoalState`, budget math, transitions.
- **New** `src/goal/evaluator.ts` — build `Context` (system + last-turn
  window), call `completeSimple`, parse `VERDICT`/`REASON`.
- **New** `src/goal/loop.ts` — `agent_end` handler (guards → evaluate →
  continue/achieve/pause), indicator update.
- **New** `src/goal/command.ts` — `registerGoalCommand(pi, opts)`
  (set/status/clear/pause/resume + aliases + arg completion + validation).
- **New** `src/goal/persist.ts` — write/restore the active-goal custom entry.
- **Edit** `src/index.ts` — call `registerGoalCommand` near
  `registerSlashCommands` (~1096) and register the `agent_end` handler;
  restore on session start.
- **Tests** `tests/goal/*.test.ts` — TDD (see implementation plan).

## 7. Out of scope (YAGNI)

- Cross-session/global (non-session) goals; multiple concurrent goals.
- Spawning the `evaluator` *subagent* (we use its model only).
- Non-interactive `-p "/goal ..."` single-shot mode (add later if headless is a
  target).

## 8. Implementation plan

See `docs/plans/2026-07-01-goal-command-plan.md`.
