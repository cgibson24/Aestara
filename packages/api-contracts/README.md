# @aestara/api-contracts

The single source for API request/response shapes: **Zod 4 schemas → OpenAPI 3.1 (`openapi.json`)**. Server validation, the admin-web client and the Swift client (swift-openapi-generator) all come from here (spec §6.8, `docs/API_CONTRACTS.md`).

**Layer 0 contents:** only the platform-wide primitives, no endpoints:

- value formats (UUID, UUIDv7 request ID, UTC timestamp with milliseconds, date, USD money)
- the error envelope and the spec §6.2 error catalog, with reusable `ErrorNNN` responses
- cursor pagination (`limit`, `cursor`, `PageInfo`) and the resource/collection envelopes
- standard headers (`X-Request-Id`, `Idempotency-Key`, `If-Match`/`ETag`, `Retry-After`) and bearer auth

Each layer adds its endpoints and DTOs here, starting with Layer 1.

```bash
pnpm --filter @aestara/api-contracts build              # regenerate openapi.json
pnpm --filter @aestara/api-contracts test               # schema tests + committed-document drift check
pnpm --filter @aestara/api-contracts openapi:check      # fail if openapi.json is stale (CI)
pnpm --filter @aestara/api-contracts openapi:breaking   # oasdiff breaking-change gate vs origin/main (needs oasdiff v1.32.1)
```

Rules:

- Import `z` from `src/zod.ts`, never from `zod`, so every schema can be registered as an OpenAPI component.
- Within `/api/v1` only additive changes are allowed. A breaking change needs `/api/v2` (spec §6.1.1); CI blocks it otherwise.
- Tenant context comes from the access token. Never add an organization header or trust an `organizationId` field as entitlement (spec §6.1.3).
- DTOs are not database models. Never export Prisma types from here.
