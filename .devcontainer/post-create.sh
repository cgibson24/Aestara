#!/usr/bin/env bash
# Runs once when a Codespace / Dev Container is created.
set -euo pipefail
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
pnpm install
python3 -m pip install --user --quiet pypdf cffi
cp -n .env.example .env || true
echo "Ready. Try: pnpm dev:prototype   |   pnpm services:up   |   pnpm check"
