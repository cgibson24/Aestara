import { defineConfig } from "prisma/config";

// DATABASE_URL is needed only by commands that touch a database (migrate, seed);
// `prisma generate` runs without it. SHADOW_DATABASE_URL is an empty scratch
// database used by the migration drift check (scripts/check-migrations.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
    ...(process.env.SHADOW_DATABASE_URL ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL } : {}),
  },
});
