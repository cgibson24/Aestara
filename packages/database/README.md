# Database

Prisma schema, per-layer migrations, roles and Row-Level Security, the permission catalog and the local seed (spec §5, §3.5; ADR-0004, ADR-0018, ADR-0019). Built in Layer 1, micro-prompt M1.1.

| Path | What |
|---|---|
| `prisma/schema.prisma` | **Generated** from `docs/technical-spec/schema.prisma`: the tables of the layers built so far (spec §5.8), copied verbatim. Never edit it; change the design and run `schema:promote` |
| `prisma/migrations/` | Per layer: `…_tables` (Prisma), `…_constraints` (that layer's `constraints.sql` fragment, verbatim), `…_security` (roles, RLS, grants), and for Layer 1 `…_catalog` |
| `src/catalog.ts` | Permission catalog, system roles and default role matrix (spec §4.3–§4.5). The catalog migration is generated from it |
| `src/ownership.ts` | The class of every table (ADR-0018 K-08): RLS, write scope and platform reach |
| `src/client.ts` | `createPrismaClient(url)` over node-postgres |
| `src/ids.ts` | `uuidv7()` |
| `scripts/` | Schema promotion, catalog generation, migration and RLS checks, database test runner, benchmark, local seed |
| `test/` | Unit tests (catalog against the spec, ownership against the schema, ids) and `sql/rls.sql`, the Row-Level Security suite |

## Commands

```bash
pnpm --filter @aestara/database build          # prisma generate (client in generated/, not committed)
pnpm --filter @aestara/database test           # unit tests
pnpm --filter @aestara/database schema:check   # schema, catalog and constraint migrations match their sources

# needs a PostgreSQL superuser connection, for example local docker compose:
export ADMIN_DATABASE_URL=postgresql://aestara:aestara_local_only@localhost:5432/aestara
pnpm --filter @aestara/database db:test        # migrations as a non-superuser, drift, RLS check, database checks
pnpm --filter @aestara/database bench:rls      # RLS performance gate (add --report-only to never fail)

DATABASE_URL=postgresql://aestara:aestara_local_only@localhost:5432/aestara pnpm --filter @aestara/database migrate:deploy
DATABASE_URL=postgresql://aestara:aestara_local_only@localhost:5432/aestara pnpm --filter @aestara/database db:seed:dev
```

`db:seed:dev` refuses anything but a local database. It creates one synthetic organization with a practice, a location and an invited ORGANIZATION_ADMIN, and prints that admin's invitation token once.

## Roles and tenant context

| Role | For | Reach |
|---|---|---|
| `aestara_app` | api and workers | Row-Level Security applies. Ledgers are insert-and-read only |
| `aestara_platform` | platform routes | Organization metadata across tenants; no grant on patient, profile or settings tables |
| `aestara_signin` | owns `auth_sign_in_memberships` | Memberships across tenants, for sign-in only |

The migrations create these three roles, which never log in. Each environment creates login users and grants each one a role. The api must never connect as the migration user or a superuser, because RLS does not apply to a superuser.

Every request or job transaction sets its tenant first:

```sql
SELECT set_config('app.organization_id', '<organization id from the verified token>', true);
```

`true` makes the setting end with the transaction, so it cannot leak through a pooled connection. With no tenant set, every tenant table returns no rows.

## RLS performance

The ADR-0004 gate is ≤ 10% added p95 and ≤ 5 ms. `bench:rls` builds a throwaway database with 20 organizations, 100,000 patients and 200,000 audit events. It times the database work of login, patient search and patient open, comparing the application role with a role that has the same privileges plus `BYPASSRLS`. Results from two runs on PostgreSQL 16:

| Request | Added p95 | Gate |
|---|---|---|
| Login | none (−14 to −17%) | Passes |
| Patient open | 0.47 to 0.71 ms (17 to 25%) | Under 5 ms; over 10% of the database work alone. An endpoint adds costs RLS does not change; measured end to end in M1.8 |
| Patient search, as specified | 3.5 to 3.7 ms (90 to 105%) | **Fails**, and grows with patients per organization |
| Patient search through a tenant-bound `SECURITY DEFINER` function (benchmark database only) | 0 to 0.4 ms (up to 10%) | Passes |

Search fails because `LIKE`, `lower()` and the trigram operators are not leakproof: under RLS, PostgreSQL may not evaluate them in an index condition ahead of the tenant policy, so it scans all of the organization's patients. The benchmark's `tuned` mode shows the alternative. The decision is UD-35 (spec §10.2) and is pending with the owner; until then CI runs the benchmark with `--report-only` and publishes the table in the job summary.
