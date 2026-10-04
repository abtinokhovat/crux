#!/bin/sh
# crux installer: downloads the latest release binary for this machine.
#   curl -fsSL https://raw.githubusercontent.com/abtinokhovat/crux/main/install.sh | sh
# Options (env): CRUX_VERSION=v0.1.0   CRUX_INSTALL_DIR=$HOME/.local/bin
set -eu

REPO="abtinokhovat/crux"
VERSION="${CRUX_VERSION:-latest}"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
  darwin|linux) ;;
  *) echo "crux: unsupported OS '$os' — on Windows download the zip from https://github.com/$REPO/releases" >&2; exit 1 ;;
esac
arch=$(uname -m)
case "$arch" in
  x86_64|amd64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "crux: unsupported CPU '$arch'" >&2; exit 1 ;;
esac

if [ "$VERSION" = "latest" ]; then
  url="https://github.com/$REPO/releases/latest/download/crux_${os}_${arch}.tar.gz"
else
  url="https://github.com/$REPO/releases/download/$VERSION/crux_${os}_${arch}.tar.gz"
fi

dir="${CRUX_INSTALL_DIR:-}"
if [ -z "$dir" ]; then
  if [ -w /usr/local/bin ]; then dir=/usr/local/bin; else dir="$HOME/.local/bin"; fi
fi
mkdir -p "$dir"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "→ downloading $url"
if ! curl -fsSL "$url" -o "$tmp/crux.tar.gz"; then
  if command -v go >/dev/null 2>&1; then
    echo "→ no release binary found; building with go install"
    GOBIN="$dir" go install "github.com/$REPO/cmd/crux@${CRUX_VERSION:-latest}"
  else
    echo "crux: download failed and Go is not installed. See https://github.com/$REPO/releases" >&2
    exit 1
  fi
else
  tar -xzf "$tmp/crux.tar.gz" -C "$tmp"
  install -m 0755 "$tmp/crux" "$dir/crux"
fi

echo "✓ installed $("$dir/crux" --version) → $dir/crux"
case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "! add $dir to your PATH:  export PATH=\"$dir:\$PATH\"" ;;
esac
cat <<'NEXT'

Next, in your project:
  crux init            # config, docs/adr, architecture map
  crux skill install   # agent skills; --agent codex|cursor|gemini|copilot|opencode|all
  crux serve --open
NEXT
