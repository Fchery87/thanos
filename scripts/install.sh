#!/usr/bin/env sh
# Thanos installer — verified release bootstrap for Linux/macOS.
# Installs/updates Thanos into ~/.pi, installs Pi if missing, and creates a `thanos` launcher.
set -eu

THANOS_REPO_URL="${THANOS_REPO_URL:-https://github.com/Fchery87/thanos.git}"
THANOS_REF="${THANOS_REF:-master}"
THANOS_VERSION="${THANOS_VERSION:-}"
THANOS_RELEASE_BASE_URL="${THANOS_RELEASE_BASE_URL:-https://github.com/Fchery87/thanos/releases/latest/download}"
THANOS_LATEST_RELEASE_API_URL="${THANOS_LATEST_RELEASE_API_URL:-https://api.github.com/repos/Fchery87/thanos/releases/latest}"
THANOS_DIR="${THANOS_DIR:-$HOME/.pi}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
SKIP_CLONE="${SKIP_CLONE:-0}"
FORCE_INSTALL="${FORCE_INSTALL:-0}"

# ── helpers ───────────────────────────────────────────────────────────────────
info()    { printf '\033[1;34m[thanos]\033[0m %s\n' "$*"; }
success() { printf '\033[1;32m[thanos]\033[0m %s\n' "$*"; }
warn()    { printf '\033[1;33m[thanos]\033[0m %s\n' "$*"; }
die()     { printf '\033[1;31m[thanos]\033[0m %s\n' "$*" >&2; exit 1; }

have_command() {
  command -v "$1" >/dev/null 2>&1
}

usage() {
  cat <<'USAGE'
Thanos installer

Usage:
  sh install.sh [options]

Options:
  --ref, -r <ref>       Legacy git ref to install when using git checkout mode
  --dir <path>          Install directory (default: ~/.pi)
  --bin-dir <path>      Directory for the `thanos` launcher (default: ~/.local/bin)
  --skip-clone          Use the existing install directory without fetching/cloning
  --force               Back up an existing non-Thanos install directory and continue
  --help, -h            Show help

Environment overrides:
  THANOS_REPO_URL       Git repository URL
  THANOS_VERSION        Release version to install, e.g. v0.3.0
  THANOS_RELEASE_BASE_URL       Base URL for release assets
  THANOS_LATEST_RELEASE_API_URL URL returning latest release JSON
  THANOS_REF            Legacy git ref for --skip-clone/update compatibility
  THANOS_DIR            Install directory
  BIN_DIR               Launcher directory

Examples:
  curl -fsSL https://github.com/Fchery87/thanos/releases/latest/download/install.sh | sh
  THANOS_VERSION=v0.3.0 curl -fsSL https://github.com/Fchery87/thanos/releases/latest/download/install.sh | sh
USAGE
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ref|-r)
        [ "$#" -ge 2 ] || die "$1 requires a value"
        THANOS_REF="$2"
        shift
        ;;
      --dir)
        [ "$#" -ge 2 ] || die "$1 requires a value"
        THANOS_DIR="$2"
        shift
        ;;
      --bin-dir)
        [ "$#" -ge 2 ] || die "$1 requires a value"
        BIN_DIR="$2"
        shift
        ;;
      --skip-clone)
        SKIP_CLONE=1
        ;;
      --force)
        FORCE_INSTALL=1
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
    shift
  done
}

ensure_git() {
  have_command git || die "git is required. Install git first, then rerun the installer."
}

checksum_command() {
  if have_command sha256sum; then
    printf '%s\n' sha256sum
    return 0
  fi
  if have_command shasum; then
    printf '%s\n' shasum
    return 0
  fi
  return 1
}

download_file() {
  url="$1"
  out="$2"
  if have_command curl; then
    curl -fsSL -o "$out" "$url"
    return
  fi
  die "curl is required to download Thanos release assets."
}

resolve_release_version() {
  if [ -n "$THANOS_VERSION" ]; then
    info "Using requested Thanos version: $THANOS_VERSION"
    RESOLVED_THANOS_VERSION="$THANOS_VERSION"
    return
  fi

  tmp_json=$(mktemp)
  download_file "$THANOS_LATEST_RELEASE_API_URL" "$tmp_json"
  version=$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp_json" | sed -n '1p')
  rm -f "$tmp_json"
  [ -n "$version" ] || die "Unable to resolve latest Thanos release version."
  info "Resolved Thanos version: $version"
  RESOLVED_THANOS_VERSION="$version"
}

verify_checksum() {
  checksum_tool=$(checksum_command) || die "Neither sha256sum nor shasum -a 256 found. Install one before running the installer."
  tarball="$1"
  sums="$2"
  artifact="$3"

  expected=$(awk -v name="$artifact" '$2 == name { print $1; exit }' "$sums")
  [ -n "$expected" ] || die "No checksum found for $artifact in SHA256SUMS."
  if [ "$checksum_tool" = "sha256sum" ]; then
    computed=$(sha256sum "$tarball" | awk '{ print $1 }')
  else
    computed=$(shasum -a 256 "$tarball" | awk '{ print $1 }')
  fi
  info "Computed checksum: $computed"
  [ "$computed" = "$expected" ] || die "Checksum mismatch for $artifact"
}

install_release_tarball() {
  checksum_command >/dev/null 2>&1 || die "Neither sha256sum nor shasum -a 256 found. Install one before running the installer."
  resolve_release_version
  version="$RESOLVED_THANOS_VERSION"
  artifact="thanos-${version}.tar.gz"
  artifact_url="${THANOS_RELEASE_BASE_URL%/}/$artifact"
  checksum_url="${THANOS_RELEASE_BASE_URL%/}/SHA256SUMS"
  tmp_dir=$(mktemp -d)
  tarball="$tmp_dir/$artifact"
  sums="$tmp_dir/SHA256SUMS"

  info "Artifact URL: $artifact_url"
  info "Checksum URL: $checksum_url"
  info "Install directory: $THANOS_DIR"
  download_file "$artifact_url" "$tarball"
  download_file "$checksum_url" "$sums"
  verify_checksum "$tarball" "$sums" "$artifact"

  if [ -e "$THANOS_DIR" ]; then
    if [ "$FORCE_INSTALL" = "1" ]; then
      backup_existing_dir
    else
      die "$THANOS_DIR already exists. Re-run with --force to back it up, or set THANOS_DIR to another path."
    fi
  fi

  parent_dir=$(dirname "$THANOS_DIR")
  mkdir -p "$parent_dir"
  extract_dir="$tmp_dir/extract"
  mkdir -p "$extract_dir"
  tar -xzf "$tarball" -C "$extract_dir"
  first_entry=$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | sed -n '1p')
  [ -n "$first_entry" ] || die "Release tarball did not contain a source directory."
  mv "$first_entry" "$THANOS_DIR"
  rm -rf "$tmp_dir"
}

is_thanos_repo() {
  [ -d "$THANOS_DIR/.git" ] || return 1
  remote_url=$(git -C "$THANOS_DIR" remote get-url origin 2>/dev/null || true)
  case "$remote_url" in
    *Fchery87/thanos*|*fchery87/thanos*) return 0 ;;
    *) return 1 ;;
  esac
}

backup_existing_dir() {
  [ -e "$THANOS_DIR" ] || return 0
  timestamp=$(date +%Y%m%d%H%M%S)
  backup_dir="${THANOS_DIR}.backup.${timestamp}"
  warn "Backing up existing $THANOS_DIR to $backup_dir"
  mv "$THANOS_DIR" "$backup_dir"
}

checkout_ref() {
  ref="$1"
  git -C "$THANOS_DIR" fetch --tags origin

  if git -C "$THANOS_DIR" rev-parse --verify --quiet "origin/$ref" >/dev/null; then
    git -C "$THANOS_DIR" checkout -B "$ref" "origin/$ref"
    git -C "$THANOS_DIR" reset --hard "origin/$ref"
    return
  fi

  git -C "$THANOS_DIR" checkout --force "$ref"
}

prepare_install_source() {
  if [ "$SKIP_CLONE" = "1" ]; then
    [ -d "$THANOS_DIR" ] || die "$THANOS_DIR does not exist; cannot use --skip-clone"
    info "Using existing Thanos checkout at $THANOS_DIR"
    return
  fi

  install_release_tarball
  return

  ensure_git

  if is_thanos_repo; then
    info "Updating existing Thanos checkout at $THANOS_DIR to $THANOS_REF"
    checkout_ref "$THANOS_REF"
    return
  fi

  if [ -e "$THANOS_DIR" ]; then
    if [ "$FORCE_INSTALL" = "1" ]; then
      backup_existing_dir
    else
      die "$THANOS_DIR already exists and is not the Thanos repository. Re-run with --force to back it up, or set THANOS_DIR to another path."
    fi
  fi

  parent_dir=$(dirname "$THANOS_DIR")
  mkdir -p "$parent_dir"
  info "Cloning Thanos from $THANOS_REPO_URL into $THANOS_DIR"
  git clone "$THANOS_REPO_URL" "$THANOS_DIR"
  checkout_ref "$THANOS_REF"
}

ensure_pi() {
  if have_command pi; then
    return
  fi

  info "Installing Pi coding agent..."
  if have_command bun; then
    bun install -g @earendil-works/pi-coding-agent
  elif have_command npm; then
    npm install -g --ignore-scripts @earendil-works/pi-coding-agent
  else
    die "Neither bun nor npm found. Install Node.js 24+ (https://nodejs.org) or Bun 1.3+ (https://bun.sh) first."
  fi
}

report_pi_version() {
  pi_version=$(pi --version 2>/dev/null || printf 'unknown version')
  info "Pi version: $pi_version"
}

install_harness() {
  old_cwd=$(pwd)
  cd "$THANOS_DIR"
  info "Installing Thanos package dependencies..."
  if have_command bun; then
    bun install
  else
    npm install
  fi
  info "Registering Thanos as a Pi package..."
  pi install .
  cd "$old_cwd"
}

setup_user_settings() {
  if [ ! -f "$THANOS_DIR/agent/settings.json" ] && [ -f "$THANOS_DIR/agent/settings.example.json" ]; then
    mkdir -p "$THANOS_DIR/agent"
    cp "$THANOS_DIR/agent/settings.example.json" "$THANOS_DIR/agent/settings.json"
    info "Created agent/settings.json from template — users can customize provider/model settings locally"
  fi
}

setup_mcp() {
  if [ ! -f "$THANOS_DIR/mcp.json" ] && [ -f "$THANOS_DIR/mcp.example.json" ]; then
    cp "$THANOS_DIR/mcp.example.json" "$THANOS_DIR/mcp.json"
    info "Created mcp.json from template — users should add their own MCP/API keys"
  fi
}

install_wrapper() {
  mkdir -p "$BIN_DIR"
  WRAPPER="$BIN_DIR/thanos"
  cat > "$WRAPPER" <<'WRAPPER_EOF'
#!/usr/bin/env sh
THANOS_DIR="${THANOS_DIR:-$HOME/.pi}"
THANOS_REF="${THANOS_REF:-master}"

if [ "${1:-}" = "update" ]; then
  shift
  printf '\033[1;34m[thanos]\033[0m Updating Thanos...\n'
  exec sh "$THANOS_DIR/scripts/install.sh" --ref "$THANOS_REF" "$@"
fi

exec pi "$@"
WRAPPER_EOF
  chmod +x "$WRAPPER"
  info "Installed thanos wrapper at $WRAPPER"
}

ensure_path() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) return ;;
  esac
  warn "$BIN_DIR is not in your PATH"
  for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [ -f "$rc" ] && ! grep -qs "export PATH=\"$BIN_DIR:\$PATH\"" "$rc"; then
      printf '\n# Thanos launcher\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$rc"
      info "Added $BIN_DIR to PATH in $rc"
    fi
  done
  warn "Open a new terminal or run: export PATH=\"$BIN_DIR:\$PATH\""
}

main() {
  parse_args "$@"
  prepare_install_source
  ensure_pi
  report_pi_version
  setup_user_settings
  setup_mcp
  install_harness
  install_wrapper
  ensure_path
  success "Thanos installed! Run 'thanos' to start a session."
  success "Run 'thanos update' anytime to pull the latest Thanos config."
  warn "Provider/API keys are not bundled. Add your own keys as environment variables or edit $THANOS_DIR/mcp.json."
}

main "$@"
