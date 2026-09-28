#!/usr/bin/env bash
# Fails when openapi.json breaks clients compared with a base branch (spec §6.1.1, §6.8).
# Usage: scripts/check-breaking.sh [base-ref]   (default: origin/main)
# Needs oasdiff: go install github.com/oasdiff/oasdiff@v1.32.1
set -euo pipefail

base_ref="${1:-origin/main}"
here="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(git -C "$here" rev-parse --show-toplevel)"
doc_path="${here#"$repo_root"/}/openapi.json"

if ! command -v oasdiff >/dev/null 2>&1; then
  echo "oasdiff not found. Install it with: go install github.com/oasdiff/oasdiff@v1.32.1" >&2
  exit 2
fi

if ! git -C "$repo_root" cat-file -e "${base_ref}:${doc_path}" 2>/dev/null; then
  echo "No ${doc_path} on ${base_ref} yet: nothing to compare (first contract baseline)."
  exit 0
fi

base_file="$(mktemp)"
trap 'rm -f "$base_file"' EXIT
git -C "$repo_root" show "${base_ref}:${doc_path}" > "$base_file"

echo "Comparing ${doc_path} against ${base_ref}…"
oasdiff breaking "$base_file" "$here/openapi.json" --fail-on ERR
echo "No breaking changes."
