# Shared types

Enum values generated from `packages/database/prisma/schema.prisma` (spec §6.8), so API contracts and services use exactly the database's values.

- `generated/enums.ts` is committed. `pnpm --filter @aestara/shared-types build` regenerates it, and CI fails if the committed file is out of date.
- It holds one `as const` array and one union type per enum. It covers only the layers that `packages/database` has built.
- Clients must tolerate values added later (spec §6.1.1).
