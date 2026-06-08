# Thanos installer for Windows (PowerShell).
# Installs/updates Thanos into %USERPROFILE%\.pi, installs Pi if missing, and creates a `thanos` launcher.
param(
  [string]$Ref = $(if ($env:THANOS_REF) { $env:THANOS_REF } else { "master" }),
  [string]$Dir = $(if ($env:THANOS_DIR) { $env:THANOS_DIR } else { Join-Path $env:USERPROFILE ".pi" }),
  [string]$BinDir = $(if ($env:BIN_DIR) { $env:BIN_DIR } else { Join-Path $env:USERPROFILE ".local\bin" }),
  [switch]$SkipClone,
  [switch]$Force,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:THANOS_REPO_URL) { $env:THANOS_REPO_URL } else { "https://github.com/Fchery87/thanos.git" }
$ThanosDir = $Dir

function Info($msg)    { Write-Host "[thanos] $msg" -ForegroundColor Blue }
function Success($msg) { Write-Host "[thanos] $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "[thanos] $msg" -ForegroundColor Yellow }
function Die($msg)     { Write-Host "[thanos] $msg" -ForegroundColor Red; exit 1 }

function Show-Help {
@"
Thanos installer

Usage:
  powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 [options]

Options:
  -Ref <ref>        Git branch, tag, or commit to install (default: master)
  -Dir <path>       Install directory (default: `$HOME\.pi)
  -BinDir <path>    Directory for the thanos.cmd launcher (default: `$HOME\.local\bin)
  -SkipClone        Use the existing install directory without fetching/cloning
  -Force            Back up an existing non-Thanos install directory and continue
  -Help             Show help

Examples:
  irm https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.ps1 | iex
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.ps1))) -Ref v0.1.0
"@
}

function Ensure-Command($Name, $Message) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Die $Message
  }
}

function Is-ThanosRepo {
  if (-not (Test-Path (Join-Path $ThanosDir ".git"))) { return $false }
  try {
    $remote = git -C $ThanosDir remote get-url origin 2>$null
    return ($remote -match "(?i)Fchery87/thanos")
  } catch {
    return $false
  }
}

function Backup-ExistingDir {
  if (-not (Test-Path $ThanosDir)) { return }
  $timestamp = Get-Date -Format "yyyyMMddHHmmss"
  $backupDir = "$ThanosDir.backup.$timestamp"
  Warn "Backing up existing $ThanosDir to $backupDir"
  Move-Item -Force $ThanosDir $backupDir
}

function Checkout-Ref($GitRef) {
  git -C $ThanosDir fetch --tags origin

  $originRef = git -C $ThanosDir rev-parse --verify --quiet "origin/$GitRef" 2>$null
  if ($LASTEXITCODE -eq 0 -and $originRef) {
    git -C $ThanosDir checkout -B $GitRef "origin/$GitRef"
    git -C $ThanosDir reset --hard "origin/$GitRef"
    return
  }

  git -C $ThanosDir checkout --force $GitRef
}

function Prepare-InstallSource {
  if ($SkipClone) {
    if (-not (Test-Path $ThanosDir)) {
      Die "$ThanosDir does not exist; cannot use -SkipClone"
    }
    Info "Using existing Thanos checkout at $ThanosDir"
    return
  }

  Ensure-Command "git" "git is required. Install Git for Windows first, then rerun the installer."

  if (Is-ThanosRepo) {
    Info "Updating existing Thanos checkout at $ThanosDir to $Ref"
    Checkout-Ref $Ref
    return
  }

  if (Test-Path $ThanosDir) {
    if ($Force) {
      Backup-ExistingDir
    } else {
      Die "$ThanosDir already exists and is not the Thanos repository. Re-run with -Force to back it up, or set -Dir to another path."
    }
  }

  $parent = Split-Path -Parent $ThanosDir
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Info "Cloning Thanos from $RepoUrl into $ThanosDir"
  git clone $RepoUrl $ThanosDir
  Checkout-Ref $Ref
}

function Ensure-Pi {
  if (Get-Command pi -ErrorAction SilentlyContinue) { return }

  Info "Installing Pi coding agent..."
  if (Get-Command bun -ErrorAction SilentlyContinue) {
    bun install -g @earendil-works/pi-coding-agent
  } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    npm install -g --ignore-scripts @earendil-works/pi-coding-agent
  } else {
    Die "Neither bun nor npm found. Install Node.js 24+ (https://nodejs.org) or Bun 1.3+ (https://bun.sh) first."
  }
}

function Install-Harness {
  Info "Installing Thanos package dependencies..."
  Push-Location $ThanosDir
  if (Get-Command bun -ErrorAction SilentlyContinue) { bun install } else { npm install }
  Info "Registering Thanos as a Pi package..."
  pi install .
  Pop-Location
}

function Setup-UserSettings {
  $settings = Join-Path $ThanosDir "agent\settings.json"
  $example = Join-Path $ThanosDir "agent\settings.example.json"
  if ((-not (Test-Path $settings)) -and (Test-Path $example)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settings) | Out-Null
    Copy-Item $example $settings
    Info "Created agent/settings.json from template — users can customize provider/model settings locally"
  }
}

function Setup-Mcp {
  $mcp = Join-Path $ThanosDir "mcp.json"
  $example = Join-Path $ThanosDir "mcp.example.json"
  if ((-not (Test-Path $mcp)) -and (Test-Path $example)) {
    Copy-Item $example $mcp
    Info "Created mcp.json from template — users should add their own MCP/API keys"
  }
}

function Setup-Models {
  $models = Join-Path $ThanosDir "agent\models.json"
  $example = Join-Path $ThanosDir "agent\models.example.json"
  if ((-not (Test-Path $models)) -and (Test-Path $example)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $models) | Out-Null
    Copy-Item $example $models
    Info "Created agent/models.json from the provider catalog — add keys via env vars or 'pi' /login"
  }
}

function Setup-WebSearch {
  $ws = Join-Path $ThanosDir "web-search.json"
  $example = Join-Path $ThanosDir "web-search.example.json"
  if ((-not (Test-Path $ws)) -and (Test-Path $example)) {
    Copy-Item $example $ws
    Info "Created web-search.json from template — add your Exa API key to enable web search"
  }
}

function Install-Wrapper {
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $wrapperPath = Join-Path $BinDir "thanos.cmd"
  @'
@echo off
setlocal
set THANOS_DIR=%THANOS_DIR%
if "%THANOS_DIR%"=="" set THANOS_DIR=%USERPROFILE%\.pi
set THANOS_REF=%THANOS_REF%
if "%THANOS_REF%"=="" set THANOS_REF=master

if "%1"=="update" (
  echo [thanos] Updating Thanos...
  powershell -ExecutionPolicy Bypass -File "%THANOS_DIR%\scripts\install.ps1" -Ref "%THANOS_REF%"
  exit /b %ERRORLEVEL%
)

pi %*
'@ | Set-Content $wrapperPath -Encoding ASCII
  Info "Installed thanos wrapper at $wrapperPath"
}

function Ensure-Path {
  $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
  if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$userPath", "User")
    Warn "Added $BinDir to user PATH — restart your terminal"
  }
}

if ($Help) {
  Show-Help
  exit 0
}

Prepare-InstallSource
Ensure-Pi
$piVersion = try { pi --version } catch { "unknown version" }
Info "Pi version: $piVersion"
Setup-UserSettings
Setup-Models
Setup-Mcp
Setup-WebSearch
Install-Harness
Install-Wrapper
Ensure-Path
Success "Thanos installed! Run 'thanos' to start a session."
Success "Run 'thanos update' anytime to pull the latest Thanos config."
Warn "Provider/API keys are not bundled. Add your own keys with 'pi' /login, as environment"
Warn "variables (e.g. `$env:THECLAWBAY_API_KEY), or by editing $ThanosDir\agent\models.json."
Warn "MCP keys go in $ThanosDir\mcp.json (and optional $ThanosDir\mcp-secrets.json)."
