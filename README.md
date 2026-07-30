# Thanos

An **Agent Distribution for the [Pi coding agent](https://earendil.works)** — a governed,
batteries-included configuration layer that turns Pi into a safe, productive daily driver.
It bundles the **Thanos Harness** governance extension, a curated provider/model setup,
and MCP configuration templates. Skills are not bundled — Pi loads them from both
`~/.agents/skills/` and `~/.pi/agent/skills/`, so drop yours in either and run `/skills`
to see what loaded.

> **Pi version:** 0.80.6 · **Provider/model:** user-configured (no keys bundled)

## Why Thanos

- **Governance first.** Every tool call is risk-tiered and evaluated against a policy
  ceiling. Secure by default: the harness asks before edits and shell commands, and
  per-repo [delivery modes](docs/governance.md#delivery-modes) let you dial in
  frictionless-but-bounded autonomy where you trust it. The `thanos` launcher can also
  apply process-level containment for unattended or high-risk sessions when the host
  supports it.
- **Governed subagents.** Thirteen specialist profiles (explore, plan, build, reviewer,
  designer, oracle, researcher, evaluator, scout, worker, and three focused reviewer
  variants) run through `pi-subagents` with typed evidence/result contracts, role-level
  tool ceilings, writer isolation, and optional per-role model routing.
- **Evidence-gated orchestration.** `/waves <goal>` runs a parent-owned, journaled
  workflow: planning, delegated investigation, bounded integration, critic jury review,
  and SpecEngine acceptance. `/waves status|pause|resume|cancel|handoff` controls a
  recoverable workflow, and `Ctrl+Shift+R` runs the standalone critic jury. Missing or
  stale evidence stops the workflow; it never falls back to an unenforced prompt.
- **Verification, not vibes.** Acceptance criteria are default-fail, and the `/goal`
  self-checking loop confirms completion against evidence rather than the model's own
  claim. The completion gate acts only on criteria derived from your actual request,
  never on generic templates.
- **MCP servers are not trusted by default.** A project-supplied `mcp.json` names a
  command that would otherwise be launched on open; untrusted servers are refused until
  you approve the exact command line via `/mcp`.
- **Bring your own keys.** A curated provider/model catalog ships with the distribution;
  credentials stay in gitignored user-owned files that install/update never touch.

## Install

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.sh | sh
```

**Windows** (PowerShell — for cmd and other options see [docs/install.md](docs/install.md)):

```powershell
irm https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.ps1 | iex
```

Then open a new terminal:

```bash
thanos         # start a session (works in bash/zsh, cmd, PowerShell, Git Bash)
```

Inside the session, add a provider key and pick a model:

```text
/login         # paste your API key (stored locally, gitignored)
/models        # choose the active model
```

Update anytime — Thanos notifies you at session start when a new release is out:

```bash
thanos update
```

Updates check out the latest release tag and **never touch your keys or settings**.

> **Prefer not to pipe a branch-tip script?** The one-liners above fetch the bootstrap
> from `master` for convenience (the install itself is pinned to the latest release
> tag). To pin the bootstrap too, fetch it from a release tag — or download and
> inspect it first: see [docs/install.md](docs/install.md#pinning-the-bootstrap-script).

## Optimal workflow

Use the smallest amount of orchestration that fits the work. This keeps context focused,
reduces cold-start overhead, and gives the verification gates evidence they can actually
check.

1. **Start in the target repository and establish trust.** Run `thanos`, then choose a
   `/delivery` mode. Keep new or sensitive repositories `local-only` + `attended`; use
   `direct-PR` + `unattended` only for repositories you explicitly trust. The mode controls
   where work may travel; autonomy controls prompting. A repository cannot grant itself
   more autonomy.

2. **Choose the model before doing expensive work.** Use `/login` for credentials,
   `/models` to select a capable model, and `/thinking` to set the reasoning level. Keep
   per-role routing off for simple tasks; turn it on with `/subagents-models` when a long
   task benefits from a stronger `plan`/reviewer/oracle/evaluator model and a faster
   implementation model. Configure fallbacks for providers that may be unavailable.

3. **Do straightforward work inline.** Read, edit, test, and small fixes are usually
   faster in the main session. Before a large task, inspect `/context` and keep the prompt
   specific: name the target, constraints, and the evidence that will prove completion.

4. **Use `/goal` for one durable objective.** Phrase it as an observable condition, for
   example `/goal all unit tests in tests/workflows pass and the typecheck is clean`. The
   goal loop continues across turns, pauses at its configured ceilings, and requires
   evidence-backed completion. Use `/goal pause`, `/goal resume`, and `/goal clear` to
   control it. Keep one active goal at a time.

5. **Delegate only bounded work.** Ask for `explore` or `plan` for read-only discovery,
   `build` or `designer` for an isolated writing slice, and `reviewer`/`oracle` for
   adversarial review. The main session should synthesize the returned contracts; avoid
   reflexively spawning agents for work that is not parallel or capability-specific.

6. **Use `/waves` for multi-slice work.** Start `/waves <goal>` when the work has
   independent investigations plus a parent integration step. The parent owns mutation;
   delegated nodes investigate and return evidence. Use `/waves status`, `pause`, `resume`,
   `handoff`, or `cancel` to control recovery. Use `Ctrl+Shift+R` when you want the
   standalone correctness/security/tests jury without a full Waves workflow.

7. **Verify before shipping.** Check `/spec`, `/todo`, `/policy`, `/audit`, and
   `/lens diagnose`; run the narrowest relevant test first, then the full suite and
   typecheck for a completed slice. For Waves, let the workflow yield and SpecEngine
   acceptance finish before claiming completion. Use `/ship` only after the repository's
   gates are green; `direct-PR` and `no-mistakes` still require the normal push/PR flow.

8. **Keep high-trust shortcuts exceptional.** Prefer `unattended` over `/yolo` for a
   trusted repository because it still respects the policy ceiling. Treat `/yolo` as a
   temporary session escape hatch, and use `no-mistakes` where Linux `bwrap` containment
   is available and required.

For the complete command reference and examples, see the [step-by-step guide](docs/guide.md)
and [governance guide](docs/governance.md).

## Documentation

| Page | Contents |
|------|----------|
| [Install](docs/install.md) | All platforms, pinned versions, updating, requirements, uninstall |
| [Step-by-step guide](docs/guide.md) | From fresh install to governed autonomous work (`/goal`, `/waves`, subagents, `/ship`) |
| [Configuration](docs/configuration.md) | API keys, provider catalog, MCP servers, repo layout, status bar |
| [Governance](docs/governance.md) | Permission gate, policy, delivery modes, subagents, Lens Lite |
| [Reference](docs/reference.md) | Tools, slash commands, keyboard shortcuts |

Design history lives in [docs/adr/](docs/adr/) and [docs/plans/](docs/plans/);
the design glossary is [CONTEXT.md](CONTEXT.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup and PR guidelines, and
[SECURITY.md](SECURITY.md) for reporting vulnerabilities privately.

## License

[MIT](LICENSE)
