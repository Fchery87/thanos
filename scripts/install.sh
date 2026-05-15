#!/usr/bin/env sh
# Thanos installer — installs Pi + verified Thanos release artifacts + thanos CLI wrapper
set -eu

THANOS_REPO_OWNER="fchery87"
THANOS_REPO_NAME="thanos"
THANOS_RELEASE_BASE_URL="${THANOS_RELEASE_BASE_URL:-https://github.com/${THANOS_REPO_OWNER}/${THANOS_REPO_NAME}/releases}"
THANOS_LATEST_RELEASE_API_URL="${THANOS_LATEST_RELEASE_API_URL:-https://api.github.com/repos/${THANOS_REPO_OWNER}/${THANOS_REPO_NAME}/releases/latest}"
THANOS_VERSION="${THANOS_VERSION:-}"
THANOS_DIR="${THANOS_DIR:-$HOME/.pi}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
SKIP_CLONE="${SKIP_CLONE:-0}"

TMPDIR=""
CHECKSUM_CMD=""
CHECKSUM_ARGS=""
VERSION=""
ARTIFACT_NAME=""
ARTIFACT_PATH=""
SUMS_PATH=""
SOURCE_DIR=""

# ── helpers ───────────────────────────────────────────────────────────────────
info()    { printf '\033[1;34m[thanos]\033[0m %s\n' "$*"; }
success() { printf '\033[1;32m[thanos]\033[0m %s\n' "$*"; }
warn()    { printf '\033[1;33m[thanos]\033[0m %s\n' "$*"; }
die()     { printf '\033[1;31m[thanos]\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [ -n "${TMPDIR:-}" ] && [ -d "$TMPDIR" ]; then
    rm -rf -- "$TMPDIR"
  fi
}

trap cleanup EXIT HUP INT TERM

have_command() {
  command -v "$1" >/dev/null 2>&1
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --skip-clone)
        SKIP_CLONE=1
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
    shift
  done
}

ensure_tmpdir() {
  if [ -z "$TMPDIR" ]; then
    TMPDIR=$(mktemp -d) || die "Failed to create temporary directory"
  fi
}

fetch_url() {
  url="$1"
  dest="$2"

  if have_command curl; then
    curl -fsSL "$url" -o "$dest"
    return
  fi

  if have_command wget; then
    wget -qO "$dest" "$url"
    return
  fi

  die "Neither curl nor wget found"
}

ensure_checksum_tool() {
  if have_command sha256sum; then
    CHECKSUM_CMD="sha256sum"
    CHECKSUM_ARGS=""
    return
  fi

  if have_command shasum; then
    CHECKSUM_CMD="shasum"
    CHECKSUM_ARGS="-a 256"
    return
  fi

  die "Neither sha256sum nor shasum -a 256 found. Install a SHA256 checksum tool and retry."
}

checksum_of() {
  file="$1"

  if [ "$CHECKSUM_CMD" = "sha256sum" ]; then
    "$CHECKSUM_CMD" "$file" | awk '{ print $1; exit }'
    return
  fi

  # shellcheck disable=SC2086
  "$CHECKSUM_CMD" $CHECKSUM_ARGS "$file" | awk '{ print $1; exit }'
}

resolve_version() {
  if [ -n "$THANOS_VERSION" ]; then
    VERSION="$THANOS_VERSION"
    info "Using requested Thanos version: $VERSION"
    return
  fi

  latest_json="$TMPDIR/latest-release.json"
  fetch_url "$THANOS_LATEST_RELEASE_API_URL" "$latest_json"
  VERSION=$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$latest_json" | awk 'NR == 1 { print; exit }')

  [ -n "$VERSION" ] || die "Unable to resolve latest Thanos release version"
  info "Resolved Thanos version: $VERSION"
}

download_release() {
  ARTIFACT_NAME="thanos-${VERSION}.tar.gz"
  ARTIFACT_PATH="$TMPDIR/$ARTIFACT_NAME"
  SUMS_PATH="$TMPDIR/SHA256SUMS"

  ARTIFACT_URL="$THANOS_RELEASE_BASE_URL/download/$VERSION/$ARTIFACT_NAME"
  SUMS_URL="$THANOS_RELEASE_BASE_URL/download/$VERSION/SHA256SUMS"

  info "Artifact URL: $ARTIFACT_URL"
  info "Checksum URL: $SUMS_URL"

  fetch_url "$ARTIFACT_URL" "$ARTIFACT_PATH"
  fetch_url "$SUMS_URL" "$SUMS_PATH"
}

verify_release() {
  expected=$(awk -v file="$ARTIFACT_NAME" '$2 == file { print $1; exit }' "$SUMS_PATH")
  [ -n "$expected" ] || die "No checksum entry found for $ARTIFACT_NAME"

  actual=$(checksum_of "$ARTIFACT_PATH")
  info "Computed checksum: $actual"

  [ "$actual" = "$expected" ] || die "Checksum mismatch for $ARTIFACT_NAME"
}

extract_release() {
  extract_dir="$TMPDIR/extract"
  mkdir -p "$extract_dir"
  tar -xzf "$ARTIFACT_PATH" -C "$extract_dir"

  set -- "$extract_dir"/*
  [ -e "$1" ] || die "Release archive did not contain an installable payload"
  SOURCE_DIR="$1"
}

sync_install_dir() {
  parent_dir=$(dirname "$THANOS_DIR")
  mkdir -p "$parent_dir"
  rm -rf -- "$THANOS_DIR"
  mkdir -p "$THANOS_DIR"
  cp -R "$SOURCE_DIR"/. "$THANOS_DIR"/
  info "Install directory: $THANOS_DIR"
}

ensure_pi() {
  if have_command pi; then
    return
  fi

  info "Installing Pi coding agent..."
  if have_command bun; then
    bun install -g @earendil-works/pi-coding-agent
  elif have_command npm; then
    npm install -g @earendil-works/pi-coding-agent
  else
    die "Neither bun nor npm found. Install Node.js (https://nodejs.org) or Bun (https://bun.sh) first."
  fi
}

report_pi_version() {
  pi_version=$(pi --version 2>/dev/null || printf 'unknown version')
  info "Pi version: $pi_version"
}

install_harness() {
  old_cwd=$(pwd)
  cd "$THANOS_DIR"
  if have_command bun; then
    bun install
  else
    npm install
  fi
  pi install .
  cd "$old_cwd"
}

setup_mcp() {
  if [ ! -f "$THANOS_DIR/mcp.json" ] && [ -f "$THANOS_DIR/mcp.example.json" ]; then
    cp "$THANOS_DIR/mcp.example.json" "$THANOS_DIR/mcp.json"
    info "Created mcp.json from template — add your API keys before using MCP servers"
  fi
}

install_wrapper() {
  mkdir -p "$BIN_DIR"
  WRAPPER="$BIN_DIR/thanos"
  cat > "$WRAPPER" <<'WRAPPER_EOF'
#!/usr/bin/env sh
THANOS_DIR="${THANOS_DIR:-$HOME/.pi}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

if [ "$1" = "update" ]; then
  printf '\033[1;34m[thanos]\033[0m Updating Thanos...\n'
  exec sh "$THANOS_DIR/scripts/install.sh"
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
    if [ -f "$rc" ]; then
      printf '\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$rc"
      info "Added $BIN_DIR to PATH in $rc"
    fi
  done
  warn "Open a new terminal or run: export PATH=\"$BIN_DIR:\$PATH\""
}

prepare_install_source() {
  if [ "$SKIP_CLONE" = "1" ]; then
    [ -d "$THANOS_DIR" ] || die "$THANOS_DIR does not exist; cannot use --skip-clone"
    info "Using existing Thanos checkout at $THANOS_DIR"
    return
  fi

  ensure_tmpdir
  ensure_checksum_tool
  resolve_version
  download_release
  verify_release
  extract_release
  sync_install_dir
}

main() {
  parse_args "$@"
  prepare_install_source
  ensure_pi
  report_pi_version
  install_harness
  setup_mcp
  install_wrapper
  ensure_path
  success "Thanos installed! Run 'thanos' to start a session."
  success "Run 'thanos update' anytime to pull the latest stable config."
}

main "$@"
