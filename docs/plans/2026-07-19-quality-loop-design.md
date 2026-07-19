# Quality Loop Design — Adaptive Ceremony, Eval Bench, Model Profiles

> **Status: DESIGN (2026-07-19).** Validated in brainstorming. Implementation plan not yet written.

## Problem

Four observed weaknesses, one root cause:

1. Weaker models (GLM/Kimi/Qwen-class) pass the gates but still underperform frontier models.
2. There is no hard evidence the harness improves results — no baseline comparison, no regression signal.
3. Quality is inconsistent run-to-run for the same kind of task.
4. Gates, juries, and specs add uniform ceremony that slows simple tasks and invites bypassing.

Root cause: the harness applies the same machinery to every task and every model, and nothing
measures which mechanisms produce lift for which model. Uniform ceremony is wrong in both
directions — too heavy for small tasks on strong models, too light (or mistargeted) for hard
tasks on weak models. Without measurement, tuning is folklore, which
`docs/harness-evolution.md` explicitly forbids.

## Goal

Make any configured model produce the best output it is capable of, with the minimum machinery
that achieves it — measured, not assumed. Model-agnostic by design: the differentiator is
**effort adaptivity conditioned on measured per-model lift**, which single-vendor harnesses
structurally cannot do.

Non-goals (deferred, see standards doc §13): OS sandbox containment, workload identity,
durable execution, supply-chain provenance. Those serve safety/distribution, not output
quality, and the user chose output quality.

## Architecture

One feedback loop, three components:

```
Effort Controller ──tier──▶ existing harness runs task
        ▲                            │
        │                            ▼
  Model Profiles ◀──derive──  Eval Bench results
```

Nothing existing is rewritten. The spec engine, verification gate, review jury, and waves all
stay; they become addressable (on/off per tier) instead of always-on.

## Component 1 — Effort Controller (`src/effort/`)

Pure function: `resolveEffort(prompt, signals, model) → { tier, reasons }`.

Tiers and what they gate, at integration points that already exist:

| Tier | Contract/spec (`before_agent_start`) | Verification gate (`src/spec/gate.ts`) | Jury (`/review` dispatch) | Waves |
| --- | --- | --- | --- | --- |
| `light` | skipped | cheap checks only | off | off |
| `standard` | today's behavior | full | on request | on request |
| `deep` | full | full | auto | available |

Heuristic resolution order (day one):

1. Explicit user override always wins: `/effort <tier>` command, or inline `quick:` prefix.
2. Touched-path risk from existing governance rule-match — security/auth/payments paths force `deep`.
3. Task-shape keywords — rename/typo/version-bump → `light`; architecture/migration/multi-file → `deep`.
4. Model profile lookup — a weak model bumps one tier up; never down past `standard` on risky paths.

Every decision logs `{ tier, reasons }` to the evolution ledger (new event type
`effort_decision`) so tier mistakes become training data.

## Component 2 — Eval Bench (`bench/` + `src/bench/`)

A fixed suite of real tasks across the four workloads:

- ~16 tasks at maturity, **6 at launch**: feature work in existing repos (5), greenfield builds
  (4), harness/tooling meta-work (4), research/analysis (3).
- Each task: `bench/tasks/<name>/task.json` — a repo fixture or worktree of a real repo at a
  pinned commit, a prompt, and graders.
- Graders are deterministic first (standards doc §2): exit status, state diff, schema,
  trajectory assertions (required tools/approvals occurred; forbidden calls did not).
  Research tasks are the one place a model grader is allowed: rubric + fresh-context evaluator,
  calibrated against the user's own judgment on the first pass.

Runner: `bun run bench -- --model <id> --arm <arm>` spawns pi headless per task in an isolated
worktree, applies graders, appends one JSONL row to `bench/results/*.jsonl`:
task, model, arm, pass/fail per criterion, tokens, wall time, tool calls.

Three arms:

- **bare** — pi without Thanos machinery (baseline).
- **harness-standard** — today's default behavior.
- **harness-deep** — full jury + evaluator + waves.

Lift = harness vs. bare. Ceremony ROI = deep vs. standard. Runs are batched and off-hours —
a weekly regression ritual, not per-commit CI.

## Component 3 — Model Capability Profiles (`agent/model-profiles.json`)

Per-model record of measured lift: default tier plus escalation rules.

Hard rules:

- **Generated artifact only.** Written exclusively by `bun run bench:profiles`, which derives
  profiles from `bench/results/` with minimum-sample guards (a model needs ≥2 full bench runs
  before its profile activates). Hand-editing a profile is vibes with extra steps.
- **v1 keeps the schema small**: per-model tier thresholds only. No per-workload × per-model ×
  per-mechanism matrices — those cells cannot be filled with statistically meaningful runs.
- **Noise fallback is honest**: if bench data is too noisy to differentiate models, profiles
  collapse to two buckets — `frontier` and `needs-scaffolding` — still better than zero buckets.
- **Staleness is visible**: the welcome screen shows profile age; >30 days or >N harness
  changes since generation gets flagged.

## Closing the loop

- Evolution ledger gains event types `effort_decision` and `bench_regression`.
- The change-manifest rule in `docs/harness-evolution.md` now has real evidence to cite:
  harness changes reference bench deltas, and follow-up checks are bench runs.

## Sequencing

1. **Week 1** — heuristic Effort Controller + `/effort` command. Immediate friction relief;
   no dependency on the bench.
2. **Weeks 2–3** — bench with 6 tasks; grow the suite as tasks recur in real work.
3. **After ≥2 full runs per model** — activate profiles; heuristics defer to measured data.

## Risks

- **Small-sample noise** in bench results → minimum-sample guards, two-bucket fallback.
- **Bench drift from real work** → tasks are drawn from recurring real tasks, revisited when
  the suite stops predicting felt quality.
- **Tier misclassification** (light tier on a task that needed deep) → user override always
  wins, decisions are ledgered, and risky paths can never resolve below `standard`.
- **Grader gaming** by strong models → deterministic graders first; the one model grader is
  calibrated and its rubric versioned.

## Testing

- `src/effort/` is pure and unit-tested (vitest, `tests/effort/`): override precedence,
  risky-path floors, profile bumps.
- Bench runner tested against a stub task fixture (no live model calls in CI).
- Profile derivation tested with synthetic results JSONL: sample guards, bucket fallback.
- Full gate stays `bun run ci`.
