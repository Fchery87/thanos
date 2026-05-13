#!/usr/bin/env sh
# Thanos installer — installs Pi + Thanos harness + thanos CLI wrapper
set -e

THANOS_REPO="https://github.com/fchery87/thanos.git"
THANOS_DIR="${THANOS_DIR:-$HOME/.pi}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
SKIP_CLONE="${SKIP_CLONE:-0}"

# ── helpers ───────────────────────────────────────────────────────────────────
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
    if [ -d "$THANOS_DIR" ] && [ "$(ls -A "$THANOS_DIR" 2>/dev/null)" ]; then
      die "$THANOS_DIR already exists and is not empty. Remove it first or use --skip-clone."
    fi
    info "Cloning Thanos to $THANOS_DIR..."
    git clone "$THANOS_REPO" "$THANOS_DIR"
  fi
}

# ── 3. install harness deps and register extension ────────────────────────────
install_harness() {
  info "Installing Thanos harness..."
  cd "$THANOS_DIR"
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
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

if [ "$1" = "update" ]; then
  printf '\033[1;34m[thanos]\033[0m Updating Thanos...\n'
  git -C "$THANOS_DIR" pull --ff-only origin master
  cd "$THANOS_DIR"
  if command -v bun >/dev/null 2>&1; then bun install; else npm install; fi
  pi install .
  # re-install wrapper in case it changed
  cp "$THANOS_DIR/scripts/install.sh" /tmp/thanos-install.sh
  chmod +x /tmp/thanos-install.sh
  SKIP_CLONE=1 /tmp/thanos-install.sh --skip-clone
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
  success "Run 'thanos update' anytime to pull the latest."
}

main "$@"
