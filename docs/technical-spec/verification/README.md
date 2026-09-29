# Specification verification

These checks back the verification report in `docs/TECHNICAL_SPECIFICATION.md` §11 and the Layer 0 acceptance review (`docs/ACCEPTANCE_CRITERIA.md`). CI runs all of them on every push. Re-run them locally whenever the Bible, the spec, the docs, `schema.prisma` or `constraints.sql` changes.

| Script | What it proves |
|---|---|
| `check_traceability.py` | Every canonical list in the Bible is represented in the spec and schema (58 checks) |
| `run_schema_checks.sh` | The schema validates, applies to an empty PostgreSQL, and the database rejects every forbidden operation: the per-layer fragments in `behavior/` (99 checks, including the V7 `MATCH SIMPLE` audit) |
| `check_docs.py` | The Bible §31/§35 documentation pack is complete; every `spec §`/Bible `§` reference, relative link and anchor resolves; no placeholder markers |
| `export_bible.py` | Generates `docs/SOFTWARE_PRODUCTION_BIBLE.md` verbatim from the PDF; `--check` fails on drift |

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

The one-command form is `DATABASE_URL=postgresql://…/empty_db pnpm verify:schema` (runs `run_schema_checks.sh`). The manual steps it performs:

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
B=<repo>/docs/technical-spec/verification/behavior
psql "$DATABASE_URL" -q $(for f in "$B"/*.sql; do printf -- '-f %s ' "$f"; done)
# every line prints PASS; the run aborts on the first FAIL; the final number is the pass count
# the suite inserts fixtures, so drop and recreate the database before re-running it
```

The behaviour suite in `behavior/` tries each violation the Bible forbids and asserts that the database itself rejects it. It is split into one fragment per layer (ADR-0018 K-19), run in one psql session in file-name order: `A00_harness.sql`, `L01_…` to `L08_…`, then `Z99_catalog_audits.sql` (the V7 audit and the summary). A fragment uses only tables of its layer and earlier ones, so `packages/database` runs just the fragments of the layers it has built against its real migrations (`pnpm --filter @aestara/database db:test`). It covers:

- cross-tenant links
- cross-patient before/after
- editing originals
- editing signed consents
- rewriting audit
- a second active model version
- releasing an unapproved simulation
- and more

It also confirms that the legitimate operations right next to each violation still succeed.

The suite ends with the V7 audit in `Z99_catalog_audits.sql`. It reads the live catalog and fails if any composite foreign key with two or more nullable columns lacks a CHECK covering those columns: PostgreSQL skips such a key whenever one column is NULL (`MATCH SIMPLE`).

## 3. Documentation pack

```bash
pip install pypdf
python3 docs/technical-spec/verification/export_bible.py --check   # Bible export matches the PDF
python3 docs/technical-spec/verification/check_docs.py             # pack, references, links, placeholders
```
