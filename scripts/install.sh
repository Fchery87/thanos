#!/usr/bin/env sh
# Thanos installer — git-based bootstrap for Linux/macOS.
# Installs/updates Thanos into ~/.pi, installs Pi if missing, and creates a `thanos` launcher.
# First install clones the repo; re-running (or `thanos update`) fetches and checks out the
# latest release tag. User-owned files (agent/auth.json, agent/models.json, mcp.json, ...)
# are gitignored and never touched by install or update.
set -eu

THANOS_REPO_URL="${THANOS_REPO_URL:-https://github.com/Fchery87/thanos.git}"
THANOS_REF="${THANOS_REF:-}"
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
  --ref, -r <ref>       Git branch, tag, or commit to install (default: latest release tag)
  --dir <path>          Install directory (default: ~/.pi)
  --bin-dir <path>      Directory for the `thanos` launcher (default: ~/.local/bin)
  --skip-clone          Use the existing install directory without fetching/cloning
  --force               Back up an existing non-Thanos install directory and continue
  --help, -h            Show help

Environment overrides:
  THANOS_REPO_URL       Git repository URL
  THANOS_REF            Git branch, tag, or commit (default: latest release tag)
  THANOS_DIR            Install directory
  BIN_DIR               Launcher directory

Examples:
  curl -fsSL https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.sh | sh
  curl -fsSL https://raw.githubusercontent.com/Fchery87/thanos/master/scripts/install.sh | sh -s -- --ref v0.2.0
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

is_thanos_repo() {
  [ -d "$THANOS_DIR/.git" ] || return 1
  remote_url=$(git -C "$THANOS_DIR" remote get-url origin 2>/dev/null || true)
  [ "$remote_url" = "$THANOS_REPO_URL" ] && return 0
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

# Resolve the ref to install: explicit THANOS_REF wins, otherwise the highest
# release tag, otherwise master. Must run after tags have been fetched.
resolve_target_ref() {
  if [ -n "$THANOS_REF" ]; then
    RESOLVED_REF="$THANOS_REF"
    info "Using requested ref: $RESOLVED_REF"
    return
  fi
  latest_tag=$(git -C "$THANOS_DIR" tag --list 'v*' --sort=-v:refname | sed -n '1p')
  if [ -n "$latest_tag" ]; then
    RESOLVED_REF="$latest_tag"
    info "Resolved latest release: $RESOLVED_REF"
  else
    RESOLVED_REF="master"
    warn "No release tags found; falling back to master"
  fi
}

checkout_ref() {
  ref="$1"
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

  ensure_git

  if is_thanos_repo; then
    info "Updating existing Thanos checkout at $THANOS_DIR"
    git -C "$THANOS_DIR" fetch --tags origin
    resolve_target_ref
    checkout_ref "$RESOLVED_REF"
    info "Now at: $(git -C "$THANOS_DIR" describe --tags --always)"
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
  git -C "$THANOS_DIR" fetch --tags origin
  resolve_target_ref
  checkout_ref "$RESOLVED_REF"
  info "Now at: $(git -C "$THANOS_DIR" describe --tags --always)"
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
  info "Patching pi-subagents (skip skills dirs in agent discovery)..."
  node "$THANOS_DIR/scripts/patch-pi-subagents.mjs" || warn "pi-subagents patch skipped (non-fatal)"
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

setup_models() {
  if [ ! -f "$THANOS_DIR/agent/models.json" ] && [ -f "$THANOS_DIR/agent/models.example.json" ]; then
    mkdir -p "$THANOS_DIR/agent"
    cp "$THANOS_DIR/agent/models.example.json" "$THANOS_DIR/agent/models.json"
    info "Created agent/models.json from the provider catalog — add keys via env vars or 'pi' /login"
  fi
}

setup_web_search() {
  if [ ! -f "$THANOS_DIR/web-search.json" ] && [ -f "$THANOS_DIR/web-search.example.json" ]; then
    cp "$THANOS_DIR/web-search.example.json" "$THANOS_DIR/web-search.json"
    info "Created web-search.json from template — add your Exa API key to enable web search"
  fi
}

install_wrapper() {
  mkdir -p "$BIN_DIR"
  WRAPPER="$BIN_DIR/thanos"
  cat > "$WRAPPER" <<'WRAPPER_EOF'
#!/usr/bin/env sh
THANOS_DIR="${THANOS_DIR:-$HOME/.pi}"

if [ "${1:-}" = "update" ]; then
  shift
  printf '\033[1;34m[thanos]\033[0m Updating Thanos...\n'
  exec sh "$THANOS_DIR/scripts/install.sh" "$@"
fi

if ! command -v pi >/dev/null 2>&1; then
  echo "[thanos] 'pi' was not found on PATH. Open a new terminal and try again."
  echo "[thanos] If it persists, reinstall: https://github.com/Fchery87/thanos"
  exit 1
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
  setup_models
  setup_mcp
  setup_web_search
  install_harness
  install_wrapper
  ensure_path
  success "Thanos installed! Run 'thanos' to start a session."
  success "Run 'thanos update' anytime to get the latest release."
  warn "Provider/API keys are not bundled. Add your own keys with 'pi' /login, as environment"
  warn "variables (e.g. export THECLAWBAY_API_KEY=...), or by editing $THANOS_DIR/agent/models.json."
  warn "MCP keys go in $THANOS_DIR/mcp.json (and optional $THANOS_DIR/mcp-secrets.json)."
}

main "$@"
