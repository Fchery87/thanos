# Main-agent-as-orchestrator workflow

Status: Reference (validated 2026-06-27)

## What it is

The recommended way to do non-trivial work in Thanos: **drive the main session
in natural language and let it orchestrate specialist subagents**, rather than
trying to do everything inline or wiring a bespoke pipeline. The main agent
(depth 0) holds the goal and context; it dispatches bounded specialists for the
parts they are best at and synthesizes their typed results.

This pattern emerged and was validated during the designer Phase 1 smoke test
(see `docs/plans/2026-06-27-designer-phase1-smoke-test.md`): asked to build and
verify a page, the main session naturally fanned out to `designer` (taste /
direction), `build` (implementation + execution), and `reviewer`/`oracle`
(critique), then assembled the result.

## The two altitudes of orchestration

Thanos supports orchestration at two levels, and they compose:

1. **Main agent orchestrates specialists (depth 0 → 1).** The default. The main
   session calls `designer`, `build`, `reviewer`, `oracle`, etc. Each runs under
   your policy as a ceiling and returns a Subagent Result Contract.
2. **A specialist delegates one level deeper (depth 1 → 2).** The live
   pi-subagents `subagent` tool permits one further level, capped by
   `maxSubagentDepth` (engine default 2). This is how a specialist obtains a
   capability it deliberately lacks — most importantly, the **exec-denied
   `designer` delegating a render + screenshot to the exec-capable `build`** as
   part of its self-validation loop. A depth-2 child cannot spawn further
   (`2 >= 2` is blocked).

Both were confirmed live on a non-Anthropic model, demonstrating the pattern is
model-agnostic.

## When to use which

| Situation | Approach |
|---|---|
| One bounded task (a review, a search, a focused edit) | Dispatch a single specialist; read its contract. |
| A goal with distinct phases (design → build → verify → critique) | Let the **main agent** orchestrate the specialists in sequence. This is the sweet spot. |
| A specialist needs a capability it lacks (e.g. designer needs to render+screenshot) | The specialist **delegates one level down** (designer → build). You do not orchestrate this; it happens inside the specialist's run. |
| A single specialist dispatch exhausts turns/context on a large job | Split the work across more, smaller dispatches from the main agent — or revisit a dedicated multi-role pipeline (designer Phase 2). |

## Why orchestrate from the main agent instead of nesting deeply

- **Governance stays legible.** Each hop narrows capabilities from the parent
  policy; read-only roles get hard `edit`/`exec` denies regardless of what the
  parent allows. Keeping orchestration at the top means the policy ceiling and
  the audit trail stay easy to reason about.
- **Context stays lean.** Specialists return artifact references for large
  output instead of inlining it, so the orchestrator's context does not bloat.
- **Depth is intentionally capped.** Deep nesting is a recognized anti-pattern;
  the depth-2 cap exists so a specialist can self-validate (designer → build)
  without spawning uncontrolled trees.

## Model routing

Specialists can be routed to different models without changing the orchestration
pattern. Use `/subagents-models-set` to pick a role and then select one of the
active models from `~/.pi/agent/models.json`. Use `/subagents-models-toggle` to
enable or disable those per-role routes.

When routing is enabled, `subagents.agentOverrides` in
`~/.pi/agent/settings.json` is active and each specialist uses its assigned
model. When routing is disabled, Thanos saves the assignments under
`subagents.savedAgentOverrides` and removes active `agentOverrides`, so the
global `/models` selection controls every subagent. This makes the reasoning
sandwich reversible: turn it on for heterogeneous specialist performance, turn
it off when you want one model to cover the entire system.

Keep vision-dependent roles such as `designer` on models that accept image input;
its self-validation loop depends on screenshot review.

## Durable progress ledger

For long jobs, the source of truth must live in files plus git, not in one
growing chat context. Use three small handoff files:

- `context.md` is compressed discovery context: retrieved files, key code,
  architecture notes, and where the next agent should start.
- `plan.md` is the intended execution sequence: ordered slices, dependencies,
  and verification expectations.
- `progress.md` is the durable ledger: what is done, what remains, evidence
  links, open decisions, and the last verified state.

`progress.md` should stay compact, about 1-2k tokens. Use this shape:

```md
# Progress

## Goal
One sentence.

## Completed
- Slice name — evidence: command/artifact/commit reference

## Remaining
- Next slice

## Open Questions
- Decision needed, or `None`

## Last Verified
Commit or command evidence.
```

The main agent should rotate context proactively around 60-70% usage and keep
each specialist's inner loop under half the window when possible. Before
dispatching a worker on a resumed long job, have it read `context.md`,
`plan.md`, and `progress.md`; after each verified slice, have it update
`progress.md` before returning.

## Bounded waves

Use `/waves <goal>` when the work naturally splits into independent research,
analysis, audit, or carefully isolated implementation slices. A waves run is
not unbounded agent spawning. The main agent must first discover the problem
shape, draft a bounded wave plan, verify independence and path ownership, then
fan out approved slices in parallel.

Read-only slices may overlap. Write slices must own disjoint paths and use
worktree-isolated writer roles (`build` or `worker`). Every worker returns a
structured handoff with status, evidence, open questions, follow-ups, and a
confidence tag. The main agent verifies those handoffs before synthesis and
drops unsupported claims under the cite-or-drop rule.

## Worked example: designer self-validation

1. You: `/designer build a pricing page for <product>` (main agent → `designer`).
2. `designer` (depth 1, exec-denied) scaffolds `DESIGN.md`, builds the page bound
   to tokens.
3. `designer` delegates a render + Playwright screenshot + console capture to
   `build` (depth 2), writing PNGs and a validation log under `.harness/design/`.
4. `designer` reads the screenshots back (vision) or uses the structural signals
   (no-vision), self-critiques against its forced 9-dimension rubric, and refines.
5. `designer` returns its Subagent Result Contract to the main agent, which
   reports to you.

If step 3's delegation is unavailable in a given run context, `designer` degrades
honestly — it emits the verification commands and flags that visual verification
was not performed — rather than claiming success it cannot back.

## Tips

- To exercise a specialist's *own* loop (not have the main agent do the work for
  it), dispatch it verbatim: "invoke `<agent>` once and return its raw contract;
  do not orchestrate, build, screenshot, or critique yourself."
- Treat the Subagent Result Contract as the interface: read `summary`, scan
  `findings[]`, open `artifacts[]` only when you need the detail.
- Keep each delegated task bounded (one coherent unit of work) so results stay
  reviewable and context stays cheap.
