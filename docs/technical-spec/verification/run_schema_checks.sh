#!/usr/bin/env bash
# Validates docs/technical-spec/schema.prisma, applies it plus constraints.sql to an
# EMPTY PostgreSQL (>= 15) database, then runs the database behaviour suite.
# Usage: DATABASE_URL=postgresql://user:pass@host:5432/emptydb bash run_schema_checks.sh
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to an empty PostgreSQL >= 15 database}"
SPEC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
echo '{ "private": true }' > package.json
npm install --silent --no-audit --no-fund prisma@7.10.0 > /dev/null
cat > prisma.config.ts <<'CFG'
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: process.env.SCHEMA_PATH!,
  datasource: { url: process.env.DATABASE_URL! },
});
CFG
export SCHEMA_PATH="$SPEC_DIR/schema.prisma"

echo "==> prisma validate"
npx prisma validate > /dev/null 2>&1 || npx prisma validate
echo "==> generate migration SQL"
npx prisma migrate diff --from-empty --to-schema "$SCHEMA_PATH" --script > migration.sql 2> /dev/null
echo "==> apply schema + constraints"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f migration.sql 2>&1 | grep -v NOTICE || true
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c 'SELECT 1' > /dev/null
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$SPEC_DIR/constraints.sql"
echo "==> behaviour suite (all layer fragments, in order)"
fragments=()
for f in "$SPEC_DIR"/verification/behavior/*.sql; do fragments+=(-f "$f"); done
if ! out="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "${fragments[@]}" 2>&1)"; then
  echo "$out" | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^ ]* //'
  echo "Behaviour suite FAILED"
  exit 1
fi
echo "$out" | grep -c "NOTICE:  PASS" | xargs -I{} echo "{} labelled checks passed"
echo "Total checks passed: $(echo "$out" | tail -1 | tr -d ' ')"
