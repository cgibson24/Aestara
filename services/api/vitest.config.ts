import { defineConfig } from "vitest/config";

// API tests run against a real PostgreSQL (ADR-0021): globalSetup migrates a
// template database once; each test file clones it. Without
// TEST_ADMIN_DATABASE_URL only the database-free tests run.
export default defineConfig({
  test: {
    globalSetup: ["test/support/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
