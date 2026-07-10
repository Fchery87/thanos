# Thanos

An **Agent Distribution for the [Pi coding agent](https://earendil.works)** — a governed,
batteries-included configuration layer that turns Pi into a safe, productive daily driver.
It bundles the **Thanos Harness** governance extension plus a curated set of npm packages
and MCP servers. Skills are not bundled — install your own via `/skills` or by dropping
them into `~/.pi/agent/skills/`.

> **Pi version:** 0.80.2+ · **Provider/model:** user-configured (no keys bundled)

## Why Thanos

- **Governance first.** Every tool call is risk-tiered and evaluated against a policy
  ceiling. Secure by default: the harness asks before edits and shell commands, and
  per-repo [delivery modes](docs/governance.md#delivery-modes) let you dial in
  frictionless-but-bounded autonomy where you trust it.
- **Governed subagents.** Eight specialist roles (explore, plan, build, reviewer,
  designer, oracle, researcher, evaluator) with typed result contracts, worktree
  isolation for writers, a code-review jury, and per-role model routing.
- **Verification, not vibes.** Acceptance criteria are default-fail; a completion gate
  and the `/goal` self-checking loop stop the model from self-certifying "done".
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
