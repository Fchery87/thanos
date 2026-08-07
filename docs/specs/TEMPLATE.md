# Spec: <title>

> File as `docs/specs/YYYY-MM-DD-<slug>.md` — dated like `docs/plans/` and
> `docs/research/`, not numbered like `docs/adr/`. A spec is written *before*
> the change; delete this blockquote when you copy the template.

A spec sits between an ADR and a plan doc, and is not a substitute for
either. An ADR (`docs/adr/`) records a decision after it is settled, in a
few paragraphs, with no lifecycle of its own. A plan doc (`docs/plans/`) is
a task-by-task execution breakdown with a `**Status:**` line, and gets
deleted on completion (`AGENTS.md` § Plan Documents). A spec is the design
document that comes *before* a nontrivial change: what problem it solves,
what it deliberately won't do, and — the part neither of the other two
formats carries — what existing code, config, or behavior the change makes
obsolete. It stays in the repo after implementation as the historical
record of what was decided and why; it does not get deleted like a plan,
and it is not a standalone decision record like an ADR. If the change turns
out to need a specific irreversible decision partway through implementation
(e.g. a vendoring call, a breaking-change cutover), write an ADR for that
decision and cite it back from this spec's Rollout section — don't fold it
in here.

## Metadata

| Field | Value |
| --- | --- |
| Author | `<name>` |
| Status | `Draft` \| `Active` \| `Superseded` |
| Created | `YYYY-MM-DD` |
| Last updated | `YYYY-MM-DD` |
| Tracking issue/PR | `<link, or "none">` |
| Compatibility posture | `<required — see below>` |

**Compatibility posture** is not optional and not a one-word answer. State
plainly whether this is a **clean break** (old callers/config/behavior stop
working, no shim) or **preserves compatibility** (old and new coexist, for
whom, for how long), and say why that posture was chosen over the other
one. Example: "Clean break — `maxExecutionTimeMs` frontmatter is rejected
outright rather than silently ignored, because a silent-ignore shim is
exactly the bug this spec fixes (see The problem)." A spec with no stated
posture forces every reader to reverse-engineer it from the diff.

## Executive summary

2-4 sentences. Someone who reads only this section should know what
changes and why, without needing the rest of the document. Do not restate
the metadata table; say what the change *is*.

## Context and motivation

What prior work this builds on or supersedes, with real paths — not a
narrative recap of them. Prefer:

- `docs/adr/00NN-<slug>.md` — a settled decision this spec extends, revisits, or depends on.
- `docs/plans/YYYY-MM-DD-<slug>.md` — a completed or in-flight plan this spec's change grew out of. (Remember completed plans are deleted from the working tree — cite `git show <commit>:docs/plans/<name>` if the content itself matters, not just the pointer.)
- `docs/research/YYYY-MM-DD-<slug>.md` — prior investigation this spec is acting on, if `docs/research/` exists in this repo and applies here.

If none of the above apply, say so explicitly rather than leaving the
section thin without comment.

## Current state

What exists today, briefly — the "before" this spec is changing, on the
record so the diff has a baseline. Cite file:line where it clarifies more
than prose. This is description, not argument; save the argument for The
problem.

## The problem

What's actually wrong or missing, concretely — a defect, a gap, a cost that
compounds. Not "X could be better" but the specific failure mode, ideally
with the trigger that reproduces it. If there's no concrete problem, this
is not yet a spec-worthy change; a plan doc or a direct implementation may
be the right size instead.

## Goals

Each goal is independently verifiable against the finished change — someone
other than the author should be able to check it off by pointing at a test,
a log line, or a diff, not by asking what it means. "Improve reliability"
is not checkable by anyone; "the watchdog no longer false-positives on
reasoning-heavy agents" is — a reviewer can point at the specific test that
proves it. If a goal reads more like the first shape than the second,
narrow it until it does.

- [ ] `<goal, phrased so it is checkable against the finished change>`
- [ ] `<goal>`

## Non-goals

This section carries as much weight as Goals. State explicitly what this
change will **not** do, and why — not just "out of scope" with no
reasoning. An undefended non-goal invites scope creep the moment someone
asks "while we're in here, why not also...".

- [ ] `<explicitly declined, with the reason>` — example shape: "NOT
      vendoring the upstream dependency this spec patches — the patch
      artifact is currently N hunks against a documented ceiling; vendoring
      is reopened only if that ceiling is crossed (see ADR 00NN), not as a
      convenience taken now."
- [ ] `<declined item #2>`

## Proposed solution

The actual design. State the mechanism, not just the intent. If the change
has more than one moving part, a short table of key components clarifies
faster than prose:

| Component | Change | File(s) |
| --- | --- | --- |
| `<name>` | `<what changes about it>` | `<path>` |

## Deletion inventory

What existing code, config, docs, or behavior does this change make
obsolete or require removing. This section must be present even when the
answer is "nothing" — a spec that adds something and deletes nothing is a
valid, but notable, case; state it rather than omitting the section.

| Item | Type | Disposition |
| --- | --- | --- |
| `<path or behavior>` | code \| config \| doc \| behavior | removed / retired / superseded by `<new thing>` |

If nothing is deleted: "Nothing existing is removed by this change — it is
additive. `<one sentence on why that's the right shape here, not a hedge>`."

## Risks

What could go wrong, and how you'd notice — not a generic risk-register
entry but the specific failure mode this design invites, and the signal
(a test, a log line, an on-call report) that would surface it.

## Rollout

How this gets implemented and shipped:

- Small enough to implement directly, in one sitting, no separate plan doc.
- Needs a `docs/plans/YYYY-MM-DD-<slug>.md` task breakdown because `<reason
  — multi-phase, multiple files, needs its own status tracking>`.
- Needs an ADR for one specific decision inside it because `<reason — an
  irreversible or contested call the spec itself shouldn't have to
  re-litigate later>`; cite it here once written.

State which of these applies and why — don't leave the reader to infer the
rollout shape from the rest of the document.
