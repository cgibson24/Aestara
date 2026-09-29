#!/usr/bin/env bash
# Builds a fresh database from the migrations, as a non-superuser migration
# user (the way a deployed environment applies them), then checks it:
#   1. Prisma sees no drift between the migrations and prisma/schema.prisma
#   2. scripts/check-rls.ts: ownership classification, RLS, roles and grants
#   3. the behaviour suite: harness, the fragments of the built layers, the RLS
#      suite (test/sql/rls.sql) and the catalog audits
# Everything it creates is dropped at the end.
#
# Usage: ADMIN_DATABASE_URL=postgresql://superuser:pw@host:5432/postgres bash scripts/test-database.sh
set -euo pipefail

: "${ADMIN_DATABASE_URL:?Set ADMIN_DATABASE_URL to a superuser connection (for example the CI service or local docker)}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
behavior="$here/../../docs/technical-spec/verification/behavior"
suffix="$(date +%s)_$$"
db="aestara_test_$suffix"
shadow="aestara_shadow_$suffix"
migrator="aestara_test_migrator"
password="test_$suffix"

base="${ADMIN_DATABASE_URL%/*}"
host_part="${base#*@}"
admin() { PGOPTIONS="-c client_min_messages=warning" psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -qAt "$@"; }
cleanup() {
  admin -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" -c "DROP DATABASE IF EXISTS $shadow WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

admin -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$migrator') THEN
    CREATE ROLE $migrator LOGIN CREATEROLE;
  END IF;
END \$\$" -c "ALTER ROLE $migrator PASSWORD '$password'"
# Where an earlier run already created the database roles, let this migrator
# administer them, as the migrator that created them would.
admin -c "DO \$\$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['aestara_app', 'aestara_platform', 'aestara_signin'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT %I TO $migrator WITH ADMIN OPTION', r);
    END IF;
  END LOOP;
END \$\$"
admin -c "CREATE DATABASE $db OWNER $migrator" -c "CREATE DATABASE $shadow OWNER $migrator"

migrator_url="postgresql://$migrator:$password@$host_part/$db"
db_admin_url="$base/$db"
cd "$here"

echo "==> prisma migrate deploy (as $migrator, not a superuser)"
DATABASE_URL="$migrator_url" npx prisma migrate deploy >/dev/null

echo "==> migrations match prisma/schema.prisma"
diff_sql="$(SHADOW_DATABASE_URL="postgresql://$migrator:$password@$host_part/$shadow" \
  npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script 2>/dev/null)"
if ! grep -q "This is an empty migration" <<<"$diff_sql"; then
  echo "$diff_sql"
  echo "FAIL  the migrations and prisma/schema.prisma differ"
  exit 1
fi
echo "PASS  no drift"

echo "==> ownership, RLS, roles and grants"
DATABASE_URL="$db_admin_url" node scripts/check-rls.ts

echo "==> behaviour suite (Layer 1 fragment + RLS suite)"
fragments=(-f "$behavior/A00_harness.sql")
layers="$(node -e 'import("./scripts/promote-schema.ts").then(m => console.log(m.PROMOTED_THROUGH_LAYER))')"
for f in "$behavior"/L*.sql; do
  n="$(basename "$f" | sed -E 's/^L0*([0-9]+)_.*/\1/')"
  if [ "$n" -le "$layers" ]; then fragments+=(-f "$f"); fi
done
fragments+=(-f test/sql/rls.sql -f "$behavior/Z99_catalog_audits.sql")
if ! out="$(psql "$db_admin_url" -v ON_ERROR_STOP=1 -q "${fragments[@]}" 2>&1)"; then
  echo "$out" | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^ ]* //'
  echo "FAIL  behaviour suite"
  exit 1
fi
echo "PASS  $(echo "$out" | tail -1 | tr -d ' ') database checks"
