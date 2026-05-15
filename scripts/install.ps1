# Thanos installer for Windows (PowerShell)
param(
  [switch]$SkipClone
)

$ErrorActionPreference = "Stop"

$RepoOwner = "fchery87"
$RepoName = "thanos"
$ReleaseBaseUrl = if ($env:THANOS_RELEASE_BASE_URL) { $env:THANOS_RELEASE_BASE_URL } else { "https://github.com/$RepoOwner/$RepoName/releases" }
$LatestReleaseApiUrl = if ($env:THANOS_LATEST_RELEASE_API_URL) { $env:THANOS_LATEST_RELEASE_API_URL } else { "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest" }
$RequestedVersion = if ($env:THANOS_VERSION) { $env:THANOS_VERSION } else { "" }
$ThanosDir = if ($env:THANOS_DIR) { $env:THANOS_DIR } else { Join-Path $env:USERPROFILE ".pi" }
$BinDir = if ($env:BIN_DIR) { $env:BIN_DIR } else { Join-Path $env:USERPROFILE ".local\bin" }
$TempDir = $null

function Info($msg)    { Write-Host "[thanos] $msg" -ForegroundColor Blue }
function Success($msg) { Write-Host "[thanos] $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "[thanos] $msg" -ForegroundColor Yellow }
function Die($msg)     { Write-Host "[thanos] $msg" -ForegroundColor Red; exit 1 }

function Ensure-Command($Name, $Message) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Die $Message
  }
}

function Fetch-File($Url, $Destination) {
  Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

function Resolve-ThanosVersion() {
  if ($RequestedVersion) {
    Info "Using requested Thanos version: $RequestedVersion"
    return $RequestedVersion
  }

  $latest = Invoke-RestMethod -Uri $LatestReleaseApiUrl -UseBasicParsing
  if (-not $latest.tag_name) {
    Die "Unable to resolve latest Thanos release version"
  }

  Info "Resolved Thanos version: $($latest.tag_name)"
  return $latest.tag_name
}

function Prepare-ReleaseInstall() {
  Ensure-Command "tar" "tar is required to extract Thanos release archives."

  $version = Resolve-ThanosVersion
  $artifactName = "thanos-$version.tar.gz"
  $artifactUrl = "$ReleaseBaseUrl/download/$version/$artifactName"
  $sumsUrl = "$ReleaseBaseUrl/download/$version/SHA256SUMS"
  $artifactPath = Join-Path $TempDir $artifactName
  $sumsPath = Join-Path $TempDir "SHA256SUMS"

  Info "Artifact URL: $artifactUrl"
  Info "Checksum URL: $sumsUrl"

  Fetch-File $artifactUrl $artifactPath
  Fetch-File $sumsUrl $sumsPath

  $expected = $null
  foreach ($line in Get-Content $sumsPath) {
    $parts = $line -split '\s+'
    if ($parts.Length -ge 2 -and $parts[1] -eq $artifactName) {
      $expected = $parts[0].ToLowerInvariant()
      break
    }
  }

  if (-not $expected) {
    Die "No checksum entry found for $artifactName"
  }

  $actual = (Get-FileHash -Algorithm SHA256 $artifactPath).Hash.ToLowerInvariant()
  Info "Computed checksum: $actual"
  if ($actual -ne $expected) {
    Die "Checksum mismatch for $artifactName"
  }

  $extractDir = Join-Path $TempDir "extract"
  New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
  tar -xzf $artifactPath -C $extractDir

  $source = Get-ChildItem $extractDir | Select-Object -First 1
  if (-not $source) {
    Die "Release archive did not contain an installable payload"
  }

  if (Test-Path $ThanosDir) {
    Remove-Item -Recurse -Force $ThanosDir
  }
  New-Item -ItemType Directory -Force -Path $ThanosDir | Out-Null
  Copy-Item -Recurse -Force (Join-Path $source.FullName "*") $ThanosDir
  Info "Install directory: $ThanosDir"
}

function Prepare-InstallSource() {
  if ($SkipClone) {
    if (-not (Test-Path $ThanosDir)) {
      Die "$ThanosDir does not exist; cannot use -SkipClone"
    }
    Info "Using existing Thanos checkout at $ThanosDir"
    return
  }

  Prepare-ReleaseInstall
}

try {
  $TempDir = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName()))
  Prepare-InstallSource

  if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
    Info "Installing Pi coding agent..."
    if (Get-Command bun -ErrorAction SilentlyContinue) {
      bun install -g @earendil-works/pi-coding-agent
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
      npm install -g @earendil-works/pi-coding-agent
    } else {
      Die "Neither bun nor npm found. Install Node.js (https://nodejs.org) or Bun (https://bun.sh) first."
    }
  }

  $piVersion = try { pi --version } catch { "unknown version" }
  Info "Pi version: $piVersion"

  Info "Installing Thanos harness..."
  Push-Location $ThanosDir
  if (Get-Command bun -ErrorAction SilentlyContinue) { bun install } else { npm install }
  pi install .
  Pop-Location

  if ((-not (Test-Path "$ThanosDir\mcp.json")) -and (Test-Path "$ThanosDir\mcp.example.json")) {
    Copy-Item "$ThanosDir\mcp.example.json" "$ThanosDir\mcp.json"
    Info "Created mcp.json from template — add your API keys"
  }

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $WrapperPath = Join-Path $BinDir "thanos.cmd"
  @'
@echo off
set THANOS_DIR=%THANOS_DIR%
if "%THANOS_DIR%"=="" set THANOS_DIR=%USERPROFILE%\.pi

if "%1"=="update" (
  echo [thanos] Updating Thanos...
  powershell -ExecutionPolicy Bypass -File "%THANOS_DIR%\scripts\install.ps1"
  exit /b %ERRORLEVEL%
)

pi %*
'@ | Set-Content $WrapperPath -Encoding ASCII
  Info "Installed thanos wrapper at $WrapperPath"

  $UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
  if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$UserPath", "User")
    Warn "Added $BinDir to user PATH — restart your terminal"
  }

  Success "Thanos installed! Run 'thanos' to start a session."
  Success "Run 'thanos update' anytime to pull the latest stable config."
} finally {
  if ($TempDir -and (Test-Path $TempDir)) {
    Remove-Item -Recurse -Force $TempDir
  }
}
