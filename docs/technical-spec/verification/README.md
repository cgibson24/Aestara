# Specification verification

These checks back the verification report in `docs/TECHNICAL_SPECIFICATION.md` §11. Re-run them whenever the Bible, the spec, `schema.prisma` or `constraints.sql` changes.

## 1. Traceability: Bible → spec + schema

Reads the Bible PDF directly and verifies that every canonical list in it is represented:

- entities
- permissions
- roles
- audit events
- state machines
- API resources
- enumerations
- required fields
- screens
- section references

It also checks the spec's internal consistency.

```bash
pip install pypdf
python3 docs/technical-spec/verification/check_traceability.py   # exit 0 = all pass
```

## 2. Schema validity and database behaviour

Needs Node.js ≥ 20 and PostgreSQL ≥ 15 (Docker works: `docker run -e POSTGRES_PASSWORD=verify -p 5432:5432 postgres:18`).

```bash
# a) scratch Prisma project (outside the repo)
mkdir -p /tmp/aestara-verify && cd /tmp/aestara-verify
npm init -y >/dev/null && npm install prisma@7.10.0 @prisma/client@7.10.0
cat > prisma.config.ts <<'EOF'
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: process.env.SCHEMA_PATH!,
  datasource: { url: process.env.DATABASE_URL! },
});
EOF
export SCHEMA_PATH=<repo>/docs/technical-spec/schema.prisma
export DATABASE_URL=postgresql://postgres:verify@localhost:5432/aestara_verify

# b) validate and generate the migration SQL
npx prisma validate
npx prisma migrate diff --from-empty --to-schema "$SCHEMA_PATH" --script > migration.sql

# c) apply schema + constraints to an empty database, then run the behaviour suite
createdb -h localhost -U postgres aestara_verify
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f migration.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f <repo>/docs/technical-spec/constraints.sql
psql "$DATABASE_URL" -q -f <repo>/docs/technical-spec/verification/schema_behavior_tests.sql
# every line prints PASS; the run aborts on the first FAIL; the final number is the pass count
# the suite inserts fixtures, so drop and recreate the database before re-running it
```

`schema_behavior_tests.sql` tries each violation the Bible forbids and asserts that the database itself rejects it:

- cross-tenant links
- cross-patient before/after
- editing originals
- editing signed consents
- rewriting audit
- a second active model version
- releasing an unapproved simulation
- and more

It also confirms that the legitimate operations right next to each violation still succeed.
