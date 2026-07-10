# Contributing to Thanos

Thanks for your interest in improving Thanos! This document covers how to set up a
development environment, run the checks, and get a change merged.

## Development setup

Thanos is a [Pi coding agent](https://earendil.works) configuration layer written in
TypeScript, managed with **Bun**.

```bash
git clone https://github.com/Fchery87/thanos.git
cd thanos
bun install
```

> **Note:** the repository doubles as a live Pi config directory (`~/.pi`) when
> installed. For development, clone it anywhere — you don't need to develop inside
> `~/.pi`.

## Running checks

All of these must pass before a PR can merge (CI runs the same commands):

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # eslint src tests
bun run test        # vitest run  — do NOT use bare `bun test` (wrong runner)
bun run ci          # all of the above
```

## Making changes

- Branch from `master`, open a pull request against `master`.
- Follow the existing commit style: conventional-commit prefixes
  (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`) with a scope where it helps,
  e.g. `feat(governance): ...`.
- Add or update tests for behavior changes — the suite lives in `tests/`,
  mirroring `src/`.
- Installer changes (`scripts/install.sh`, `scripts/install.ps1`) must keep the two
  platforms behaviorally in sync and are covered by `tests/scripts/install.test.ts`.
- Never commit secrets. Live config files (`agent/models.json`, `mcp.json`,
  `agent/auth.json`, …) are gitignored; only `*.example.json` templates are tracked.
- Skills (`agent/skills/`) are intentionally **not** part of the distribution —
  don't add them to the repo.

## Releases

Releases are cut by tagging: pushing a `v*` tag runs CI and publishes a GitHub
release. Release notes are auto-generated from merged PRs (there is no manually
maintained CHANGELOG — see the [releases page](https://github.com/Fchery87/thanos/releases)).
The tag must match the `version` field in `package.json`; CI enforces this.

## Reporting bugs and requesting features

Use the [issue templates](https://github.com/Fchery87/thanos/issues/new/choose).
For security issues, see [SECURITY.md](SECURITY.md) — please do not open public
issues for vulnerabilities.
