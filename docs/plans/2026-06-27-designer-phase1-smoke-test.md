# Designer Phase 1 — Live Smoke-Test Brief

Date: 2026-06-27
Purpose: validate the upgraded `designer` subagent in a real Pi session, covering
the behaviors unit tests cannot exercise (tool resolution, delegation, the
self-validation loop + degradation, the forced rubric, structured output).

Run from a Pi session on branch `designer-fable-upgrade`. Each scenario lists the
prompt to issue, what to watch, and the pass criteria. Note your model's vision
capability first (`/models` — image badge), since the loop forks on it.

---

## Scenario 0 — Tool & boundary sanity (30s)

**Prompt (to your main Pi agent):**
> Dispatch the `designer` subagent with this task: "List the tools you actually
> have available, then state whether you can run shell commands. Do not build
> anything."

**Pass criteria**
- Designer reports it has `read, ls, find, grep, write, edit, web_search,
  fetch_content, subagent`.
- It states it **cannot** run shell/`bash` (exec is policy-denied) and that it
  delegates execution to a subagent.
- ❌ Fail if it claims it can run bash/Playwright itself.

---

## Scenario A — UI build + self-validation loop (the core test)

**Setup:** an empty scratch dir, no design context.

**Prompt:**
> Dispatch `designer`: "Build a single-file HTML pricing page for a fictional
> note-taking app called Margin. No brand assets exist. Establish a DESIGN.md
> first, then build, then verify your output."

**Watch for, in order**
1. **Direction advisor** fires (no context) — offers 3 distinct named directions,
   not one generic minimal take.
2. **DESIGN.md** gets scaffolded with semantic tokens + a Forbidden-patterns list,
   and the page binds to it (no raw hex/px sprinkled inline).
3. **Self-validation loop**:
   - It attempts to **delegate** a render+screenshot to an exec-capable subagent
     (e.g. `build`) writing a PNG + console log under `.harness/design/`.
   - **Vision model:** it then reads the PNG back and critiques the actual render.
   - **No-vision model:** it uses the structural signals (console-clean, layout
     assertions) and critiques the code.
   - **If delegation is blocked** (leaf/depth): it must NOT claim visual success —
     it emits the exact verification commands and flags "visual verification NOT
     performed — recommend a build handoff or human/vision pass."
4. **Forced rubric** appears before "done": 9 dimensions scored, with Keep /
   Fixes-by-severity / Top-3 quick wins.
5. **Structured output**: summary names the design direction + states covered +
   verification performed; findings[] lists trade-offs / missing tokens.

**Pass criteria**
- All five behaviors present. The single most important one: **either a real
  screenshot-backed critique OR an explicit, honest degradation flag** — never a
  silent "looks good."
- ❌ Fail if it declares done with no rubric, or asserts the page looks correct
  without either a screenshot or a degradation note.

---

## Scenario B — Fact verification + anti-slop

**Prompt:**
> Dispatch `designer`: "Make a one-screen launch hero for the latest Pixel phone.
> Get the real current model and its key specs before designing."

**Pass criteria**
- It uses `web_search`/`fetch_content` to confirm the current model/specs **before**
  designing, and records facts (e.g. `product-facts.md`) rather than asserting from
  memory.
- If it can't verify, it asks rather than inventing.
- Output avoids AI-slop tropes (no purple gradient / emoji icons / fake stats) or
  justifies any by real brand usage.
- ❌ Fail if it states a model/spec from memory without verifying.

---

## Scenario C — Critique-only (always-on rubric, no build)

**Setup:** point it at the Scenario A HTML (or any existing UI file).

**Prompt:**
> Dispatch `designer`: "Review <path-to-file> only — do not edit it. Score it."

**Pass criteria**
- Produces the full 9-dimension rubric with scores, verdict, Keep, Fixes by
  severity, Top-3 quick wins.
- Critiques the design, not the author; cites concrete elements.
- ❌ Fail if it edits the file, or returns vague taste commentary without scores.

---

## What a clean pass looks like

- Scenario 0: correct tool list + honest no-exec statement.
- Scenario A: DESIGN.md + bound build + (screenshot critique OR honest degradation)
  + rubric + structured output.
- Scenario B: real verification before design; no slop.
- Scenario C: scored rubric, read-only respected.

## If something fails

- **Designer tries to run bash directly / errors on exec** → expected denial;
  confirm it then degrades to delegation, not that it gives up.
- **Delegation never attempted, no degradation note** → prompt-adherence gap; tighten
  the self-validation-loop wording in `designer.md`.
- **No rubric before done** → tighten "Forced critique rubric" / Definition of done.
- **Frontmatter not recognized at load** → check field names against the
  pi-subagents engine `KNOWN_FIELDS` (agents.ts).

Record results inline here or in the PR description so Phase 2 can build on a
verified Phase 1.
