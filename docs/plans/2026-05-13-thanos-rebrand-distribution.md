# Thanos Rebrand & Distribution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebrand the Pi harness config layer as "Thanos", add a `thanos` CLI launcher with `thanos update`, and ship three install paths (curl script, git clone, npx).

**Architecture:** The root `~/.pi` repo IS Thanos. Pi is the runtime engine it depends on. The `install.sh` bootstraps Pi if missing, clones/updates the Thanos repo to `~/.pi`, installs the harness extension, and drops a `thanos` wrapper at `~/.local/bin/thanos`. The wrapper passes all args to `pi`, except `thanos update` which pulls the repo and reinstalls the extension.

**Tech Stack:** Bash (install.sh), PowerShell (install.ps1), Node.js/Bun (npm package), Pi extension API (`@earendil-works/pi-coding-agent`)

---

### Task 1: Fix README.md — repo URL + install section

**Files:**
- Modify: `README.md`

**Step 1: Fix repo URL casing (Thanos → thanos)**

In `README.md`, change every occurrence of:
```
https://github.com/fchery87/Thanos.git
```
to:
```
https://github.com/fchery87/thanos.git
```

**Step 2: Replace the Setup section with the three install paths**

Replace the existing `## Setup` section with:

```markdown
## Install

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/fchery87/thanos/master/scripts/install.sh | sh
```

This installs Pi (if missing), clones Thanos to `~/.pi`, installs the harness extension, and adds the `thanos` command to your PATH.

### Manual clone

```bash
git clone https://github.com/fchery87/thanos.git ~/.pi
~/.pi/scripts/install.sh --skip-clone
```

### npm / npx

```bash
npx thanos-install
```

After any install method, open a new terminal and run:

```bash
thanos
```
```

**Step 3: Update keyboard shortcuts table — replace `Ctrl+Shift+Y` yolo description to be accurate**

No change needed — keep as-is.

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: fix repo URL casing and add three-path install section"
```

---

### Task 2: Create `scripts/install.sh`

**Files:**
- Create: `scripts/install.sh`

**Step 1: Write the script**

```bash
#!/usr/bin/env sh
# Thanos installer — installs Pi + Thanos harness + thanos CLI wrapper
set -e

THANOS_REPO="https://github.com/fchery87/thanos.git"
THANOS_DIR="${THANOS_DIR:-$HOME/.pi}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
SKIP_CLONE="${SKIP_CLONE:-0}"

# ── helpers ──────────────────────────────────────────────────────────────────
info()    { printf '\033[1;34m[thanos]\033[0m %s\n' "$*"; }
success() { printf '\033[1;32m[thanos]\033[0m %s\n' "$*"; }
warn()    { printf '\033[1;33m[thanos]\033[0m %s\n' "$*"; }
die()     { printf '\033[1;31m[thanos]\033[0m %s\n' "$*" >&2; exit 1; }

parse_args() {
  for arg in "$@"; do
    case "$arg" in
      --skip-clone) SKIP_CLONE=1 ;;
    esac
  done
}

# ── 1. ensure Pi is installed ─────────────────────────────────────────────────
ensure_pi() {
  if command -v pi >/dev/null 2>&1; then
    info "Pi already installed: $(pi --version 2>/dev/null || echo 'unknown version')"
    return
  fi
  info "Installing Pi coding agent..."
  if command -v bun >/dev/null 2>&1; then
    bun install -g @earendil-works/pi-coding-agent
  elif command -v npm >/dev/null 2>&1; then
    npm install -g @earendil-works/pi-coding-agent
  else
    die "Neither bun nor npm found. Install Node.js (https://nodejs.org) or Bun (https://bun.sh) first."
  fi
}

# ── 2. clone or update Thanos repo to ~/.pi ───────────────────────────────────
setup_thanos_dir() {
  if [ "$SKIP_CLONE" = "1" ]; then
    info "Skipping clone (--skip-clone set)"
    return
  fi
  if [ -d "$THANOS_DIR/.git" ]; then
    info "Updating Thanos at $THANOS_DIR..."
    git -C "$THANOS_DIR" pull --ff-only origin master
  else
    info "Cloning Thanos to $THANOS_DIR..."
    git clone "$THANOS_REPO" "$THANOS_DIR"
  fi
}

# ── 3. install harness extension ──────────────────────────────────────────────
install_harness() {
  HARNESS_DIR="$THANOS_DIR/agent/extensions/harness"
  if [ ! -d "$HARNESS_DIR" ]; then
    warn "Harness directory not found at $HARNESS_DIR — skipping extension install"
    return
  fi
  info "Installing harness extension..."
  cd "$HARNESS_DIR"
  if command -v bun >/dev/null 2>&1; then
    bun install
  else
    npm install
  fi
  pi install .
  cd - >/dev/null
}

# ── 4. copy MCP example config if mcp.json missing ───────────────────────────
setup_mcp() {
  if [ ! -f "$THANOS_DIR/mcp.json" ] && [ -f "$THANOS_DIR/mcp.example.json" ]; then
    cp "$THANOS_DIR/mcp.example.json" "$THANOS_DIR/mcp.json"
    info "Created mcp.json from template — add your API keys before using MCP servers"
  fi
}

# ── 5. install thanos wrapper ─────────────────────────────────────────────────
install_wrapper() {
  mkdir -p "$BIN_DIR"
  WRAPPER="$BIN_DIR/thanos"
  cat > "$WRAPPER" << 'WRAPPER_EOF'
#!/usr/bin/env sh
THANOS_DIR="${THANOS_DIR:-$HOME/.pi}"

if [ "$1" = "update" ]; then
  printf '\033[1;34m[thanos]\033[0m Updating Thanos...\n'
  git -C "$THANOS_DIR" pull --ff-only origin master
  HARNESS_DIR="$THANOS_DIR/agent/extensions/harness"
  if [ -d "$HARNESS_DIR" ]; then
    cd "$HARNESS_DIR"
    if command -v bun >/dev/null 2>&1; then bun install; else npm install; fi
    pi install .
  fi
  printf '\033[1;32m[thanos]\033[0m Done — Thanos is up to date.\n'
  exit 0
fi

exec pi "$@"
WRAPPER_EOF
  chmod +x "$WRAPPER"
  info "Installed thanos wrapper at $WRAPPER"
}

# ── 6. ensure BIN_DIR is on PATH ──────────────────────────────────────────────
ensure_path() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) return ;;
  esac
  warn "$BIN_DIR is not in your PATH"
  for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [ -f "$rc" ]; then
      printf '\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$rc"
      info "Added $BIN_DIR to PATH in $rc"
    fi
  done
  warn "Open a new terminal or run: export PATH=\"$BIN_DIR:\$PATH\""
}

# ── main ──────────────────────────────────────────────────────────────────────
main() {
  parse_args "$@"
  ensure_pi
  setup_thanos_dir
  install_harness
  setup_mcp
  install_wrapper
  ensure_path
  success "Thanos installed! Run 'thanos' to start a session."
  success "Run 'thanos update' anytime to pull the latest Thanos config."
}

main "$@"
```

**Step 2: Make it executable**

```bash
chmod +x scripts/install.sh
```

**Step 3: Smoke test the wrapper section manually**

Read the script and verify:
- `thanos update` path runs `git pull` + harness reinstall
- all other args pass through to `pi "$@"`
- `--skip-clone` flag is respected

**Step 4: Commit**

```bash
git add scripts/install.sh
git commit -m "feat: add install.sh — bootstraps Pi, clones Thanos, installs harness + thanos wrapper"
```

---

### Task 3: Create `scripts/install.ps1` (Windows)

**Files:**
- Create: `scripts/install.ps1`

**Step 1: Write the PowerShell script**

```powershell
# Thanos installer for Windows (PowerShell)
param(
  [switch]$SkipClone
)

$ThanosRepo = "https://github.com/fchery87/thanos.git"
$ThanosDir  = if ($env:THANOS_DIR) { $env:THANOS_DIR } else { "$env:USERPROFILE\.pi" }
$BinDir     = "$env:USERPROFILE\.local\bin"

function Info($msg)    { Write-Host "[thanos] $msg" -ForegroundColor Blue }
function Success($msg) { Write-Host "[thanos] $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "[thanos] $msg" -ForegroundColor Yellow }
function Die($msg)     { Write-Host "[thanos] $msg" -ForegroundColor Red; exit 1 }

# 1. Ensure Pi
if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
  Info "Installing Pi coding agent..."
  if (Get-Command bun -ErrorAction SilentlyContinue) {
    bun install -g @earendil-works/pi-coding-agent
  } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    npm install -g @earendil-works/pi-coding-agent
  } else {
    Die "Neither bun nor npm found. Install Node.js or Bun first."
  }
} else {
  Info "Pi already installed."
}

# 2. Clone or update
if (-not $SkipClone) {
  if (Test-Path "$ThanosDir\.git") {
    Info "Updating Thanos at $ThanosDir..."
    git -C $ThanosDir pull --ff-only origin master
  } else {
    Info "Cloning Thanos to $ThanosDir..."
    git clone $ThanosRepo $ThanosDir
  }
}

# 3. Install harness
$HarnessDir = "$ThanosDir\agent\extensions\harness"
if (Test-Path $HarnessDir) {
  Info "Installing harness extension..."
  Push-Location $HarnessDir
  if (Get-Command bun -ErrorAction SilentlyContinue) { bun install } else { npm install }
  pi install .
  Pop-Location
}

# 4. MCP config
if (-not (Test-Path "$ThanosDir\mcp.json") -and (Test-Path "$ThanosDir\mcp.example.json")) {
  Copy-Item "$ThanosDir\mcp.example.json" "$ThanosDir\mcp.json"
  Info "Created mcp.json from template — add your API keys"
}

# 5. thanos.cmd wrapper
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$WrapperPath = "$BinDir\thanos.cmd"
@'
@echo off
set THANOS_DIR=%THANOS_DIR%
if "%THANOS_DIR%"=="" set THANOS_DIR=%USERPROFILE%\.pi

if "%1"=="update" (
  echo [thanos] Updating Thanos...
  git -C "%THANOS_DIR%" pull --ff-only origin master
  cd /d "%THANOS_DIR%\agent\extensions\harness"
  where bun >nul 2>&1 && bun install || npm install
  pi install .
  echo [thanos] Done.
  exit /b 0
)

pi %*
'@ | Set-Content $WrapperPath
Info "Installed thanos wrapper at $WrapperPath"

# 6. PATH
$UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($UserPath -notlike "*$BinDir*") {
  [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$UserPath", "User")
  Warn "Added $BinDir to user PATH — restart your terminal"
}

Success "Thanos installed! Run 'thanos' to start a session."
Success "Run 'thanos update' anytime to pull the latest."
```

**Step 2: Commit**

```bash
git add scripts/install.ps1
git commit -m "feat: add install.ps1 — Windows PowerShell installer"
```

---

### Task 4: Update `package.json` — rename + add npm bin

**Files:**
- Modify: `package.json`

**Step 1: Update name, add bin + install script**

Replace the current `package.json` content with:

```json
{
  "name": "thanos-install",
  "version": "0.1.0",
  "description": "Thanos — Pi harness config layer. One-command installer.",
  "type": "module",
  "bin": {
    "thanos-install": "./scripts/npm-install.mjs"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests",
    "ci": "bun run typecheck && bun run lint && bun test"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "^0.74.0",
    "eslint": "^9.0.0",
    "typescript": "^5.4.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^2.0.0"
  }
}
```

**Step 2: Create `scripts/npm-install.mjs`** — the Node.js entry point `npx thanos-install` calls

```js
#!/usr/bin/env node
import { execSync } from "node:child_process";
import { platform } from "node:os";

const isWindows = platform() === "win32";

if (isWindows) {
  const url =
    "https://raw.githubusercontent.com/fchery87/thanos/master/scripts/install.ps1";
  execSync(`powershell -ExecutionPolicy Bypass -Command "irm ${url} | iex"`, {
    stdio: "inherit",
  });
} else {
  const url =
    "https://raw.githubusercontent.com/fchery87/thanos/master/scripts/install.sh";
  execSync(`curl -fsSL ${url} | sh`, { stdio: "inherit" });
}
```

Make it executable: `chmod +x scripts/npm-install.mjs`

**Step 3: Commit**

```bash
git add package.json scripts/npm-install.mjs
git commit -m "feat: rename package to thanos-install, add npx entry point"
```

---

### Task 5: Update `release.yml` — rebrand release title

**Files:**
- Modify: `.github/workflows/release.yml`

**Step 1: Update release title**

Change:
```yaml
--title "Harness ${{ github.ref_name }}" \
```
to:
```yaml
--title "Thanos ${{ github.ref_name }}" \
```

**Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "chore: rebrand release title from Harness to Thanos"
```

---

### Task 6: Update `CONTEXT.md` — accurate Thanos/Pi glossary entry

**Files:**
- Modify: `CONTEXT.md`

**Step 1: Update the top-level description**

Change the first line of the `# Harness Extension — Context` heading to:
```markdown
# Thanos — Context
```

Update the **Harness** glossary entry to:
```markdown
**Thanos**
The Pi config/harness layer living at `~/.pi`. Adds capability-based permissions, an ambient spec lifecycle, and subagent delegation to Pi. Distributed at `github.com/fchery87/thanos`. Installed via `curl -fsSL .../install.sh | sh` or `npx thanos-install`.
```

**Step 2: Commit**

```bash
git add CONTEXT.md
git commit -m "docs: rebrand CONTEXT.md — Harness → Thanos"
```

---

### Task 7: Smoke test end-to-end

**Step 1: Verify the wrapper script is syntactically valid**

```bash
sh -n scripts/install.sh
```
Expected: no output (no syntax errors)

**Step 2: Verify `thanos update` block in wrapper**

Run the generated wrapper in dry-run style (don't actually execute, just confirm the update path logic is present):

```bash
grep -A 10 'update' scripts/install.sh
```
Expected: sees the `thanos update` block calling `git pull` and `pi install .`

**Step 3: Verify npm entry point is executable**

```bash
ls -la scripts/npm-install.mjs
```
Expected: `-rwxr-xr-x`

**Step 4: Final commit if any fixes needed, then tag**

```bash
git tag v0.2.0
```
(Do not push tag until user confirms they're ready to publish to npm)

---

## Summary of files changed

| File | Action |
|------|--------|
| `README.md` | Fix repo URL casing + new install section |
| `scripts/install.sh` | Create — POSIX installer |
| `scripts/install.ps1` | Create — Windows installer |
| `scripts/npm-install.mjs` | Create — npx entry point |
| `package.json` | Rename to `thanos-install`, add `bin` |
| `.github/workflows/release.yml` | Update release title |
| `CONTEXT.md` | Rebrand Harness → Thanos |
