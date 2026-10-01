# Security

Shared authorization primitives, permission catalog, PHI-safe logging serializers.

**Status:** placeholder, by decision (ADR-0022). In Layer 1 the api is the only consumer, so the permission catalog lives in `packages/database/src/catalog.ts` (it seeds the database), and authorization, step-up and PHI-safe logging live in `services/api/src/common/` and `services/api/src/auth/`. They move here when a second service needs them (the Layer 2 workers), rather than being shared before anything shares them.

Permission keys: spec §4.4. Roadmap: `docs/DEVELOPMENT_ROADMAP.md`.
