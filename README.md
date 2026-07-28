# Thanos

An **Agent Distribution for the [Pi coding agent](https://earendil.works)** — a governed,
batteries-included configuration layer that turns Pi into a safe, productive daily driver.
It bundles the **Thanos Harness** governance extension plus a curated set of npm packages
and MCP servers. Skills are not bundled — drop your own into `~/.pi/agent/skills/`, then
run `/skills` to see what loaded.

> **Pi version:** 0.80.6 · **Provider/model:** user-configured (no keys bundled)

## Why Thanos

- **Governance first.** Every tool call is risk-tiered and evaluated against a policy
  ceiling. Secure by default: the harness asks before edits and shell commands, and
  per-repo [delivery modes](docs/governance.md#delivery-modes) let you dial in
  frictionless-but-bounded autonomy where you trust it.
- **Governed subagents.** A dozen specialist roles (explore, plan, build, reviewer and
  three focused reviewer variants, oracle, researcher, evaluator, scout, worker) with
  typed result contracts, worktree isolation for writers, and per-role model routing.
  `/waves` and `Ctrl+Shift+R` compose decomposition and code-review prompts — they are
  prompts, not enforced runtimes.
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

## Documentation

| Page | Contents |
|------|----------|
| [Install](docs/install.md) | All platforms, pinned versions, updating, requirements, uninstall |
| [Step-by-step guide](docs/guide.md) | From fresh install to governed autonomous work (`/goal`, subagents, `/ship`) |
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
