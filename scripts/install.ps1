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
    Die "Neither bun nor npm found. Install Node.js (https://nodejs.org) or Bun (https://bun.sh) first."
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
    if ((Test-Path $ThanosDir) -and (Get-ChildItem $ThanosDir -ErrorAction SilentlyContinue)) {
      Die "$ThanosDir already exists and is not empty. Remove it first or use -SkipClone."
    }
    Info "Cloning Thanos to $ThanosDir..."
    git clone $ThanosRepo $ThanosDir
  }
}

# 3. Install harness deps and register extension
Info "Installing Thanos harness..."
Push-Location $ThanosDir
if (Get-Command bun -ErrorAction SilentlyContinue) { bun install } else { npm install }
pi install .
Pop-Location

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
  pushd "%THANOS_DIR%"
  where bun >nul 2>&1 && bun install || npm install
  pi install .
  popd
  echo [thanos] Done.
  exit /b 0
)

pi %*
'@ | Set-Content $WrapperPath -Encoding ASCII
Info "Installed thanos wrapper at $WrapperPath"

# 6. PATH
$UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($UserPath -notlike "*$BinDir*") {
  [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$UserPath", "User")
  Warn "Added $BinDir to user PATH — restart your terminal"
}

Success "Thanos installed! Run 'thanos' to start a session."
Success "Run 'thanos update' anytime to pull the latest."
