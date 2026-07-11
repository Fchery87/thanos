# Security Policy

## Supported versions

Only the latest release of Thanos is supported. Run `thanos update` to get current.

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Instead, report privately via
[GitHub Security Advisories](https://github.com/Fchery87/thanos/security/advisories/new).

Include:

- A description of the issue and its impact
- Steps to reproduce
- Affected version (`thanos version`, or the release you installed)

You should receive an acknowledgement within a few days. Once a fix is released,
the advisory will be published with credit (unless you prefer otherwise).

## Scope notes

- Thanos never bundles or transmits maintainer API keys. User credentials live in
  gitignored local files (`agent/auth.json`, `agent/models.json`, `mcp.json`,
  `mcp-secrets.json`, `web-search.json`). A report showing any path where these
  could be committed, exfiltrated, or logged is in scope and high priority.
- The installer pipeline (`scripts/install.sh`, `scripts/install.ps1`, release
  workflow) is in scope — anything that could cause users to execute unintended
  code during install or `thanos update`.
- The governance/permission layer (`src/governance`, `src/permissions`,
  `src/policy`) is in scope — bypasses of deny rules or the risk tier are
  security bugs, not just correctness bugs.
