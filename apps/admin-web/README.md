# Administrative web portal

React 19 + TypeScript + Vite static SPA on TanStack Router and TanStack Query, with a client generated from the OpenAPI contract (ADR-0003, spec §2.2 D-03). Layer 1 delivers the shell the owner confirmed at the kickoff (ADR-0018 K-23; ADR-0022):

- sign-in with password and TOTP or a passkey, authenticator enrollment, organization choice
- invitation acceptance and password reset from email links (token in the URL fragment, posted in the body)
- users and roles: invite, assign and remove roles, revoke sessions, reset a second factor, disable
- the audit log with filters, including the per-patient access report
- your account: signed-in devices, password change, passkeys

Every action is authorized by the api; the portal only hides what the caller cannot do. The access token is kept in memory; the refresh token is an `HttpOnly` cookie limited to the refresh path. The Content Security Policy and companion headers are in `security-headers.ts`.

```bash
pnpm generate          # src/api/schema.ts from packages/api-contracts/openapi.json (CI checks drift)
pnpm dev               # http://localhost:5174, /api proxied to AESTARA_API_URL (default http://127.0.0.1:3000)
pnpm test              # unit tests (Vitest, jsdom)
TEST_ADMIN_DATABASE_URL=… pnpm e2e   # Playwright against the real api and a fresh database (after `pnpm build` at the root)
```

To run against a local api, see "Run Layer 1 locally" in the root README. Styling consumes `@aestara/design-tokens/tokens.css` only.
