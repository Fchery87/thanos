# Designer Agent — Fable-Class Upgrade (Design)

Date: 2026-06-27
Status: Approved design, pre-implementation
Scope: Phased. Phase 1 (single elite agent) built first; Phase 2 (multi-agent
pipeline) designed now, built later.

## Goal

Bring the `designer` subagent (`agent/agents/designer.md`) up to par with
Anthropic's Fable 5 as a design specialist, while remaining **model-agnostic** —
it must behave as close to Fable as the underlying model allows, and degrade
gracefully on models without Fable's native abilities.

Target domains (all four): production web/app UI, design exploration, mobile/app
prototypes, critique & audit.

## Research basis

Sourced via Exa (2026-06-27). Key findings:

**What makes Fable 5 specifically strong at design** (anthropic.com/claude/fable,
anthropic.com/news/claude-fable-5-mythos-5, UX Planet, BytePointer):
- Vision-based **self-validation**: screenshots its own rendered output, compares
  against the goal/design, then refines (the "screenshot loop"). Most-cited
  reason its UI looks polished where other models do not.
- Interprets *intent* rather than copying pixels; catches design holes.
- Tests its own work over long-horizon, multi-step tasks.

**What makes any design agent good, independent of model** (reopt Handbook
"Design Systems for the AI Era", Superdesign, Stitch DESIGN.md, Naya Moss):
1. A persistent `DESIGN.md` / token "prompt interface" — colors, type, spacing,
   radius, motion, **forbidden patterns**. "First 500 tokens matter most."
2. A critique loop with a concrete rubric (surface fit, component reuse, token
   discipline, density, accessibility, responsiveness, visual restraint,
   evidence).
3. The screenshot feedback loop — "Claude writes correct CSS but cannot evaluate
   its own visual output."
4. Named anti-patterns + CRITICAL emphasis so weaker models comply.
5. Role-specific sequencing: UX (structure) -> UI (implement) -> validate.
6. A structured output contract (component choices, missing tokens, screenshots,
   assumptions).

**Model-agnostic insight:** Fable's edge (innate vision self-check + intent
reading) can be compensated for with *scaffolding* in any model — explicit
screenshot-loop tooling, a structured `DESIGN.md`, and a forced critique rubric.
That scaffolding is what makes the system model-agnostic: weaker models get as
*instructions + tools* what Fable does *natively*.

Runtime facts confirmed in this repo:
- Vision is a **per-model** capability (`/models` selector shows image badges) —
  so the screenshot loop must detect-and-degrade.
- Nested subagents work (`reviewer` already spawns them) — Phase 2 is feasible.
- `designer` currently grants only `read, ls, find, grep, write, edit`.

## Current gaps in `designer.md`

1. **Broken tool contract:** the prompt tells the agent to use
   `web_search`/`fetch_content` and run Playwright checks, but `tools:` grants
   none of `bash`, `web_search`, `fetch_content`, `subagent`. Fact verification
   and the screenshot loop are currently impossible.
2. No codified vision/screenshot self-validation loop (Fable's #1 trait).
3. No persistent design-token / `DESIGN.md` convention.
4. No forced critique rubric — critique is mode-E, on request only; Fable
   self-critiques always.
5. Old frontmatter: missing `thinking: high`, `inheritProjectContext`,
   `inheritSkills`, `defaultContext`, and a structured output contract that
   `worker`/`build`/`reviewer` use.

## Phase 1 — single elite agent

### 1. Model-agnostic spine: render -> screenshot -> evaluate -> refine

Explicit loop with a capability fork:
- **Vision-capable model:** Playwright screenshots the rendered output; the agent
  reads the PNG back, critiques against the goal, iterates until the rubric
  passes.
- **No-vision model:** degrade to structural checks (console errors == 0,
  computed-style/layout assertions, responsive breakpoint checks via Playwright)
  + apply the rubric to the *code*, then explicitly flag "visual self-check not
  performed — recommend a vision/human pass."

This single fork is the core of model-agnosticism.

### 2. Tool grants (fix the broken contract)

`tools: read, ls, find, grep, write, edit, bash, web_search, fetch_content, subagent`

### 3. Frontmatter modernization

Match `worker`/`build` conventions: add `thinking: high`,
`inheritProjectContext: true`, `inheritSkills: false`, `defaultContext`, and a
**Subagent Result Contract** output shape (summary + findings[] + artifact refs).

### 4. Operating modes (kept; each wired to the spine)

- **A. Design-Direction Advisor** (exploration): backed by `subagent` to run the
  huashu 3-parallel-directions flow (roulette / real-world-benchmark /
  best-designer) as real parallel subagents; serial fallback if unavailable.
- **B. High-fidelity web/app UI:** mandatory render->screenshot->critique loop;
  must read/create `DESIGN.md` tokens first.
- **C. App/mobile prototype:** single-file inline React + device-frame rules;
  Playwright click-test (enter detail / key annotation / tab switch,
  `pageerror === 0`) becomes a **required gate**.
- **D. Slide/deck/animation:** unchanged grammar (showcase-first, motion
  narrative); screenshot loop applies per page.
- **E. Expert critique** (audit): promoted to **always-on self-critique** before
  declaring done; also runs standalone on request.

### 5. Forced critique rubric (run before every "done")

Self-scored 0-10; cannot claim completion if a P0/P1 dimension fails.

| Dimension | Pass condition |
|---|---|
| Surface fit | Matches the real product surface (tool / dashboard / marketing / game / mobile) |
| Context fidelity | Grown from real brand/assets/tokens, not invented |
| Visual hierarchy | Clear focal path; type scale matches viewing distance |
| Token discipline | Colors/spacing/radius/type/motion from `DESIGN.md` — no hard-coded values |
| Density | Matches workflow + viewport (compact <-> editorial) |
| State coverage | Empty/loading/error/success/disabled/mobile/focus all handled |
| Accessibility | Visible focus, labels, contrast, keyboard — not deferred |
| Anti-slop restraint | No purple-gradient / emoji-icon / nested-card / fake-stat filler; every element earns its place |
| Evidence | Screenshots (or degraded-mode note), console-clean, assumptions listed |

Loop output: keep / fixes-by-severity (fatal / important / polish) / top-3 quick
wins.

### 6. `DESIGN.md` token convention (persistent prompt interface)

On any UI task:
1. Look for an existing token source in priority order: `DESIGN.md` ->
   `design-system.md` -> `brand-spec.md` -> Tailwind/CSS config / existing
   component tokens.
2. If none exists and the work is durable, scaffold a minimal `DESIGN.md`:
   semantic color roles (not raw hex), type scale + font pairing, spacing rhythm,
   radius, motion, elevation, density target, and a **Forbidden patterns** list.
   Confirm with the user before treating it as canonical.
3. Bind to it: no hard-coded `#hex` / `px` / `bg-blue-500`; values come from
   tokens. Report any token needed but not found.

Stays subordinate to huashu's "context-grown" rule: real brand assets > invented
tokens. `DESIGN.md` records what was decided so it is not re-guessed.

## Phase 2 — multi-agent pipeline (designed now, built later)

`designer` becomes an orchestrator that fans out via `subagent`:
- `design-ux` -> structure, flows, IA, states (read-only + writes a brief).
- `design-ui` -> implements against the brief + `DESIGN.md`.
- `design-critic` -> runs the rubric + screenshot loop, returns graded findings;
  loop back to `design-ui` until pass.

Plus the exploration fan-out (3 parallel directions) from Mode A.

Phase 2 reuses Phase 1's rubric, loop, and `DESIGN.md` as shared contracts, so
Phase 1 is a strict subset — no rework. Build trigger: single-agent jobs hitting
`maxTurns`/context limits on large multi-screen work.

## Out of scope (YAGNI)

- New runtime/engine changes to pi-subagents (config-only where needed).
- Auto-generating brand assets; the agent gathers/links real assets per huashu's
  asset protocol, it does not fabricate them.
- Building Phase 2 sub-role agent files now (designed, deferred).

## Verification plan (for implementation)

- Frontmatter parses and the agent loads in the live roster.
- Tool grants resolve (web/bash/subagent available to the agent at runtime).
- A vision-capable run produces screenshots + a rubric self-score.
- A no-vision run degrades: structural checks run, visual-check-skipped flag set.
- Existing tests still pass (`tests/agents/*`).
