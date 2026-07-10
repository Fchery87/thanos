# Installing Thanos

Thanos is distributed directly from GitHub. The installer clones the repository into
`~/.pi` (the directory Pi reads user packages and settings from), checks out the
**latest release tag**, installs the Pi coding agent if missing, creates your
user-owned config files from templates, and puts a `thanos` launcher on your PATH.

## Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.sh | sh
```

## Windows

From **PowerShell**:

```powershell
irm https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.ps1 | iex
```

From **Command Prompt (cmd)**:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.ps1 | iex"
```

The installer itself runs in PowerShell (it ships with every Windows 10/11 machine), but
the `thanos` command it installs works from **cmd, PowerShell, and Git Bash** alike.

## First run

Open a new terminal and run:

```bash
thanos
```

The first launch creates your user-owned config files (`agent/models.json`,
`agent/settings.json`, `mcp.json`, `web-search.json`) from the committed
`*.example.json` templates. Nothing is overwritten if it already exists. Then add a
provider key — see [Configuration](configuration.md).

## Updating

```bash
thanos update
```

This fetches the repository and checks out the latest release tag. Your user-owned
files (`agent/auth.json`, `agent/models.json`, `agent/settings.json`, `mcp.json`,
sessions, …) are gitignored and **never touched by an update**.

When a new release is available, Thanos also tells you at session start:

```text
Thanos v0.3.0 is available (you have v0.2.0) — run 'thanos update' to upgrade.
```

The check hits the GitHub releases API at most once every 24 hours, fails silently when
offline, and can be disabled entirely with `THANOS_SKIP_UPDATE_CHECK=1`.

## Installing a pinned tag or branch

```bash
curl -fsSL https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.sh | sh -s -- --ref v0.2.0
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.ps1))) -Ref v0.2.0
```

`--ref` / `-Ref` accepts any branch, tag, or commit. Without it, installs and updates
resolve to the latest release tag. `THANOS_REF` works as an environment override,
including for `thanos update`.

## Existing Pi users

The default install location is `~/.pi` because Pi reads user packages and settings
from there. If `~/.pi` already exists and is not the Thanos repo, the installer stops
instead of overwriting it. To intentionally back it up and install Thanos, pass
`--force` on Linux/macOS or `-Force` on Windows — the previous directory is moved to
`~/.pi.backup.<timestamp>`.

## Requirements

- Git
- Node.js 24+ with npm, or Bun 1.3+
- [Pi coding agent](https://earendil.works) v0.80.2+ (installed automatically if missing)
- curl on Linux/macOS, or PowerShell on Windows
- Optional: `xclip` for Linux clipboard support
- Optional: `ffmpeg` + `yt-dlp` for video frame extraction

## Uninstalling

```bash
rm -rf ~/.pi ~/.local/bin/thanos
```

(On Windows: delete `%USERPROFILE%\.pi` and the `thanos*` launchers in
`%USERPROFILE%\.local\bin`.) Your API keys live inside `~/.pi`, so export anything you
want to keep first.
