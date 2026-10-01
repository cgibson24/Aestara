# Application API

NestJS 12 on Fastify 5, TypeScript, ES modules (ADR-0021). Staff and admin API under `/api/v1`: authentication, tenancy and authorization, organizations, users and roles, patients, audit and settings (spec §3, §4, §6). Built in Layer 1, micro-prompts M1.2 to M1.8.

| Path | What |
|---|---|
| `src/app.ts` | Builds the app; checks that the routes equal the endpoint registry |
| `src/common/pipeline.ts` | Every request: authenticate → validate → tenant transaction → session and grants → permission, step-up → idempotency → handler → envelope and ETag |
| `src/common/` | Error envelope, request IDs and security headers, PHI-safe logging, cursors, scope rules (separation of duties), optimistic concurrency |
| `src/db/` | Two pools (`aestara_app` with Row-Level Security, `aestara_platform`), tenant transactions |
| `src/auth/` | Sign-in, MFA (TOTP, passkeys), sessions and refresh rotation, lockout, passwords, invitations, token signing and secret sealing |
| `src/organizations/`, `src/users/`, `src/patients/`, `src/audit/`, `src/settings/` | The Layer 1 resources |
| `test/` | Unit tests, and HTTP tests against a real PostgreSQL, including authorization and cross-tenant tests generated from the registry |

Contracts: `packages/api-contracts` (the endpoint registry is `src/endpoints.ts`). Conventions: `docs/API_CONTRACTS.md` and spec §6.

## Commands

```bash
pnpm --filter @aestara/api test        # unit tests; database tests too when TEST_ADMIN_DATABASE_URL is set
TEST_ADMIN_DATABASE_URL=postgresql://aestara:aestara_local_only@localhost:5432/aestara pnpm turbo run test --filter=@aestara/api
pnpm --filter @aestara/api build       # dist/main.js (rolldown)
pnpm --filter @aestara/api start       # needs the environment below
```

The test runner migrates a template database once as a non-superuser migration user, clones it for each test file, and connects the api as login users of `aestara_app` and `aestara_platform`.

## Configuration

Validated at start-up (`src/config.ts`); an invalid variable is named, never echoed.

| Variable | What |
|---|---|
| `DATABASE_URL`, `PLATFORM_DATABASE_URL` | Login users that are members of `aestara_app` and `aestara_platform`. Never the migration user or a superuser |
| `API_SECRET_KEY` | 32+ random bytes, base64. HMAC keys for refresh tokens, cursors and the lockout identifier are derived from it |
| `JWT_SIGNER`, `JWT_PRIVATE_KEY_PEM` / `JWT_KMS_KEY_ID`, `JWT_KEY_ID` | ES256 access-token signing: a local P-256 PEM key, or a KMS key (required in production) |
| `SECRET_SEALER`, `SECRET_SEAL_KEY` / `SECRET_KMS_KEY_ID` | Sealing of TOTP seeds: AES-256-GCM locally, KMS in production |
| `ADMIN_WEB_ORIGINS`, `ADMIN_WEB_URL` | CORS and refresh-cookie origin allow-list; base URL for email links |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGINS` | Passkey relying party |
| `EMAIL_TRANSPORT`, `EMAIL_FROM`, `MAILPIT_URL` | `memory`, `mailpit` (local) or `ses` (production) |
| `TRUST_PROXY`, `HOST`, `PORT`, `LOG_LEVEL`, `DATABASE_POOL_SIZE`, `AWS_REGION` | Runtime |

Logs are JSON lines with the request ID, route template, operation, status and duration. Bodies, headers, cookies, tokens, URLs with identifiers and error messages are never logged (spec §7.2).
