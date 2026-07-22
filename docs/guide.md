# Using Thanos — step by step

This walkthrough takes you from a fresh install to a governed, productive session. Each step is independent — skip ahead if you already have it set up.

## Step 1 — Install and launch

```bash
curl -fsSL https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.sh | sh
thanos
```

(Windows install commands are in [Installing Thanos](install.md).)

The first launch creates your user-owned config files (`models.json`, `settings.json`, `mcp.json`, …) from the committed `*.example.json` templates. Nothing is overwritten if it already exists.

## Step 2 — Add a provider key and pick a model

No API keys ship with Thanos — you bring your own.

```text
/login        # pick a provider → "Use an API key" → paste; stored in agent/auth.json
/models       # choose the active model from configured providers
```

Providers without credentials do not appear in `/models`. Add a key with `/login`, an environment
variable, or a shell-command credential first; see [Adding keys](configuration.md#adding-keys) for the alternatives.

## Step 3 — Understand the permission model (important)

Thanos is **secure by default**. Yolo mode is **off**, so the harness asks before it edits a file or runs a shell command. You will see a permission prompt for each `edit`/`write` (high risk) and each `bash` call (critical risk). This is intentional — it's what keeps an agent from acting without your sign-off.

You have three ways to reduce prompting, in increasing order of trust:

1. **Approve per action** — answer each prompt as it comes. Maximum control.
2. **Mark a repo `unattended`** in your captain registry (Step 4) — auto-approves actions *within* that repo's policy ceiling, so no prompts for allowed work. Pair it with `mode: "direct-PR"` if you also want commit **and** push with no prompts; `local-only` keeps the same no-prompt feel but blocks push. Deny rules always still block.
3. **Yolo** (`/yolo` or `Ctrl+Shift+Y`) — available in **every** delivery mode; a one-time confirmation skips permission prompts and risk gating for the session. It does **not** cross the protection floor: explicit policy denies, local-only egress/push guards, the Lens Lite secret scan, and the pre-critical rollback snapshot all still apply. It is refused when yolo is locked (see [Yolo lockout](governance.md#yolo-lockout)) or when the repo is `unattended`.

> Prefer option 2 over option 3. `unattended` keeps the interactive ceiling (asks become auto-allows only *within* the ceiling); yolo additionally waves through what the ceiling would prompt for — including unrecognized tools — so reach for it only in trusted repos. Neither one crosses an explicit deny.

## Step 4 — Register your projects (delivery modes)

Tell Thanos how far each repo's work may travel and how autonomously it may act there. This is the file that makes coding frictionless: list the repos you trust as `unattended` so they stop prompting, and pick a `mode` that allows what you need (e.g. pushing).

**The easy way:** just launch Thanos in the repo. Unregistered projects get a one-time selector at session start ("New project — choose a delivery mode"); your choice is saved to `~/.pi/agent/projects.json`. Run `/delivery` anytime to change it (e.g. `/delivery direct-PR`). The selector grants modes only — for `unattended` autonomy, edit the file:

```bash
cp ~/.pi/agent/projects.example.json ~/.pi/agent/projects.json
# then edit ~/.pi/agent/projects.json
```

**Recommended frictionless setup — code, commit, *and* push with no approval prompts:**

```jsonc
{
  "version": 1,
  "default": { "mode": "local-only", "autonomy": "unattended" }, // no prompts anywhere; push only on listed repos
  "projects": [
    {
      "match": "https://github.com/you/your-repo.git", // matched against `git remote get-url origin`
      "path": "/home/you/code/your-repo",              // fallback match when there's no remote
      "mode": "direct-PR",                              // allows commit AND push (local-only would block push)
      "autonomy": "unattended"                          // auto-approve all allowed actions — zero prompts
    }
  ]
}
```

The `mode` is what gates pushing, and `autonomy` is what gates prompting:

- `mode: "direct-PR"` (or `no-mistakes`) → `git push` / PRs are allowed. `mode: "local-only"` → push is denied.
- `autonomy: "unattended"` → no approval prompts for anything the mode allows. `autonomy: "attended"` → prompts as usual.

So `direct-PR` + `unattended` = the frictionless "just let me work" experience, while still keeping the free guardrails (Pi can't read your `.env`/keys, and the secret-scan blocks committing a leaked key). For maximum security on a sensitive repo, use `local-only` + `attended` instead; to hard-disable yolo, add top-level `"yolo": "disabled"`.

This file is **gitignored and trusted** — only you edit it, and a repo can never grant itself more autonomy (see [Trust-split](governance.md#trust-split)). The full reference is in [Delivery modes](governance.md#delivery-modes).

## Step 5 — Do the work, delegating to subagents

Drive the session in natural language. For bounded, parallelizable, or adversarial work, delegate to a **specialist subagent** instead of doing it inline:

```text
/designer <goal>    # spawn the Designer for UI/UX work
Ctrl+Shift+R        # spawn a Reviewer for a structured P0–P3 review
Ctrl+Shift+D        # spawn the Designer
```

Delegation runs through the pi-subagents `subagent` tool — ask for a specialist by name ("have a reviewer check this") or use the shortcuts above. (The pre-pi-subagents `task` tool and its `/modes` selector are legacy, dormant unless `THANOS_LEGACY_TASK=1`.)

Subagents run under your policy as a ceiling, return a typed result contract, and nest at most one level deeper (capped). Driving from the main session and letting it orchestrate specialists is the recommended pattern — see [Main-agent-as-orchestrator workflow](governance.md#main-agent-as-orchestrator-workflow) and [Governed subagents](governance.md#governed-subagents).

### Optional per-subagent model routing

Thanos can route each specialist role to its own model from your active `~/.pi/agent/models.json` catalog. This is the "reasoning sandwich": deep reasoning roles such as `oracle`, `plan`, and reviewers can use stronger/high-thinking models, while mechanical roles can use faster or cheaper models.

Routing ships **toggled off**: the example settings stash a full per-role table in `savedAgentOverrides`, and `/subagents-models-toggle on` activates it. While off, every subagent — and the `/goal` completion checker — uses the session model.

Use the visible slash commands:

```text
/subagents-models          # show current routing and usage
/subagents-models-set      # pick a role, then pick one of your active models
/subagents-models-set reviewer
/subagents-models-toggle   # pick on/off
/subagents-models-toggle on
/subagents-models-toggle off
```

When routing is **on**, `subagents.agentOverrides` is active and each assigned role uses its configured model. When routing is **off**, Thanos saves the assignments under `subagents.savedAgentOverrides` and removes active `agentOverrides`, so the model selected with `/models` controls all subagents as it did before per-role routing existed. Editing routes while disabled updates the saved assignments without activating them.

The [`/goal`](#goal--self-checking-autonomous-loop) evaluator follows this same toggle via the `evaluator` role: its assignment powers goal verdicts while routing is on, and the session model takes over while routing is off. Assignments support cross-family fallbacks (`fallback=<model[,model...]>`), so a provider wobble on the primary fails over instead of stalling the role.

Long provider/model references are shortened in the picker so the terminal UI stays stable while scrolling, but Thanos still saves the full model reference in `settings.json`.

## Step 6 — Track and verify

```text
/todo               # phased checklist for the current branch (survives reload)
/spec               # acceptance criteria derived from your prompt + verification state
/lens diagnose      # bounded lint/diff checks on changed files only
/policy             # show the active governance policy ceiling
/audit              # review what was allowed/denied this session
```

### Completion verification gate

For non-instant implementation tasks, Thanos treats the active spec as the definition of done. When the agent tries to stop while acceptance criteria are still missing evidence, the harness sends a bounded follow-up turn with the unmet criteria instead of letting the model self-certify completion. The loop is parent-session only, keeps the original spec active across continuation turns, and stops after three reinjections.

Evidence comes from the normal harness channels: diffs, passing test or command output, and explicit manual evidence. If you need to debug the harness itself or temporarily bypass this loop, start Thanos with:

```bash
THANOS_VERIFY_GATE=off thanos
```

This disables only the completion verification reinjection gate. It does not disable policy, yolo lockout, Lens Lite, or delivery-mode restrictions.

### `/goal` — self-checking autonomous loop

`/goal <condition>` turns a prompt into a durable objective. Thanos immediately starts a turn toward the condition and auto-continues after each turn with the goal as guidance. Completion is **agent-signaled**: when the agent believes the goal is met, it calls the `goal_complete` tool with a summary of what it finished and the verifying evidence. A fresh, tool-less **checker** (a one-shot `completeSimple` call, not a subagent — so no extra agent turn and no re-entrancy) then confirms the claim against the last work turn's real output pulled from the session branch — never against the bare summary alone (missing evidence fails closed). `MET` clears the goal and records the achievement; `NOT_MET` rejects the call with the reason and the loop keeps working. Checker errors and unparseable output are treated as `NOT_MET` (fail-safe: it never declares a false "done", and a checker error never pauses the goal).

Because the checker cannot run tools and sees **only the final message plus the last tool outputs** of the turn it judges, every goal directive carries an explicit evidence contract: the working agent must end each reply with concrete evidence (test output, exit codes, counts, git status) — a `goal_complete` call without surfaced proof is rejected. Goals phrased as objectively checkable conditions ("all tests in X pass — paste the output") converge in far fewer turns than vague ones.

The evaluator's model follows [per-subagent model routing](#optional-per-subagent-model-routing): when routing is **on**, the `evaluator` role's assignment (primary, then fallbacks, first registered + authed model wins) powers the verdicts; when routing is **off** or nothing resolves, the current session model is used. The routing entry is re-read per evaluation, so toggling takes effect mid-session.

```text
/goal <condition>   # set a goal and start working toward it
/goal               # status (condition, turns, context growth, last check)
/goal pause         # stop auto-continuing (resumable)
/goal resume        # resume: re-kicks work immediately with a fresh ceiling window
/goal clear         # cancel (aliases: stop off reset none cancel)
```

The loop is **guarded**: it pauses (never clears) on a turn ceiling (`maxTurns`, default 25), an optional context-growth ceiling (`maxTokens`), or an optional `checkpointEvery`. Ceilings are **windows, not lifetime caps**: `/goal resume` rebases both counters, so resuming a ceiling pause grants another full window (e.g. 25 more turns) — and it queues a continuation directive itself, so work restarts without you having to type anything further. A statusline segment shows `◎ goal:<turns>t·<growth>k` while active. It is main-session only and refuses on untrusted projects. Permission prompts are orthogonal — a tool needing approval pauses the loop until you answer.

`/goal` and the completion verification gate never fight: while a goal is active, the goal loop is the **sole** continuation driver (the gate defers), so at most one follow-up is queued per turn. Configure defaults under `goal` in `~/.pi/agent/settings.json`:

```jsonc
"goal": {
  "maxTurns": 25,        // pause on hit (0 = unlimited / full-auto)
  "maxTokens": 0,        // cumulative context-growth ceiling, NOT a spend cap; 0 = off
  "checkpointEvery": 0,  // 0 = off; N = pause-to-confirm every N turns
  "evaluatorRole": "evaluator"  // routing role whose model grades verdicts (session model when routing is off)
}
```

> `maxTokens` is a context-**growth** guard, not a spend meter: it accumulates clamped per-turn context growth (compaction can never make it go backwards). `maxTurns` remains the real budget.

## Step 7 — Ship it

When your gates are green, deliver the branch per its resolved mode:

```text
/ship
```

- **local-only** → a fast-forward-only merge of the current branch into your local default branch. It **never pushes**; if the branches diverged, it reports the failure rather than force-merging.
- **direct-PR / no-mistakes** → informational in v1: confirm gates, then push / open the PR yourself.

See [/ship](governance.md#ship) for details.
