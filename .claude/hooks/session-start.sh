#!/bin/bash
# Claude Code on the web: make every new cloud session ready to lint, test and build.
# Installs the pinned Node LTS (.nvmrc) if missing, enables pnpm via corepack,
# installs workspace dependencies and the Python tools used by spec verification.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"
ENV_FILE="${CLAUDE_ENV_FILE:-/dev/null}"
NODE_VERSION="$(tr -d '[:space:]' < .nvmrc)"
NODE_MAJOR="${NODE_VERSION%%.*}"

current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)"
if [ "$current_major" != "$NODE_MAJOR" ]; then
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) echo "unsupported architecture $(uname -m)" >&2; exit 1 ;;
  esac
  dest="/opt/node-v${NODE_VERSION}"
  if [ ! -x "$dest/bin/node" ]; then
    tarball="node-v${NODE_VERSION}-linux-${arch}.tar.xz"
    tmp="$(mktemp -d)"
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${tarball}" -o "$tmp/$tarball"
    (cd "$tmp" && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" | grep " ${tarball}\$" | sha256sum -c - > /dev/null)
    mkdir -p "$dest"
    tar -xJf "$tmp/$tarball" -C "$dest" --strip-components=1
    rm -rf "$tmp"
  fi
  export PATH="$dest/bin:$PATH"
  echo "export PATH=\"$dest/bin:\$PATH\"" >> "$ENV_FILE"
fi

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
echo "export COREPACK_ENABLE_DOWNLOAD_PROMPT=0" >> "$ENV_FILE"
corepack enable
pnpm install

python3 -m pip install --quiet pypdf cffi 2>/dev/null \
  || python3 -m pip install --quiet --break-system-packages pypdf cffi
