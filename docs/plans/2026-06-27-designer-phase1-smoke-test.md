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

---

## Results — 2026-06-27: PASS (live-validated)

Run model: `theclawbay/gpt-5.5:high` (a **non-Anthropic** model — model-agnostic
claim validated). Sandbox: a scratch project dir; ~10 turns, ~13m40s, ~$0.75.

**First run (looser prompt) — inconclusive.** The MAIN Pi agent orchestrated
`designer` + `build` + `reviewer` + `oracle` itself, so `designer.md` was only
used for direction advice. Tell: the responder said it *could* run shell, and the
critique used an improvised rubric, not the forced 9. Lesson: to exercise the
designer itself, dispatch it verbatim with "do not orchestrate, build, screenshot,
or critique yourself; invoke `designer` once and return its raw contract."

**Second run (verbatim designer-only dispatch) — PASS on every criterion**, with
on-disk evidence verified independently (not taken from the agent's report):

| Criterion | Result |
|---|---|
| Real designer ran (not orchestrator) | ✅ "I cannot run shell commands myself in this session" |
| `designer.md` drove it | ✅ Emitted the exact forced 9-dimension rubric |
| Depth-1 designer spawned depth-2 `build` child | ✅ `subagent {"agent":"build"}` fired; soft "don't spawn" boundary did NOT block it |
| Vision readback | ✅ `read` of desktop/mobile PNGs, then real-render critique |
| Delegated screenshot loop | ✅ Validation log PASS: console/page errors 0; annual toggle 149/349/950→125/291/792; FAQ expand; 4 focus stops with visible rings |
| Token discipline | ✅ Raw hex only in `:root` token block; body uses `var(--…)` |
| Structured contract | ✅ summary + findings + rubric + fixes-by-severity + quick wins |

Renders were genuine (desktop 1440×4495, mobile 390×8665). The `build` child even
authored and ran a `pricing-verify.py` against headless Chrome.

**Caveats:** transient OpenAI 502s mid-run (API hiccups, not the designer — it
completed anyway); the full loop is thorough but not cheap (~$0.75/page).

**Conclusion:** Phase 1 is verified end-to-end and model-agnostic. The nested-spawn
mechanism Phase 2 depends on works. Phase 2 (design-ux/design-ui/design-critic
split) remains deferred per YAGNI — its build trigger (a single designer dispatch
exhausting turns/context on large multi-screen work) has not been hit; one page ran
comfortably in ~10 turns.
