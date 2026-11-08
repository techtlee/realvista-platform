import { defineConfig } from 'vitest/config'

/**
 * Two projects so `pnpm test` stays fast and offline:
 * - unit: real temp-dir filesystem, fake Exec/Pg/Http/Procs (Postgres tests
 *   use DBs `cwunit4_%` and skip when no server is reachable)
 * - e2e: opt-in (`pnpm test:e2e`), real cms/platform/Postgres
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/outward/**/*.test.ts', 'tests/*.unit.test.ts'],
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['tests/e2e/**/*.test.ts', 'tests/*.int.test.ts'],
          testTimeout: 600_000,
          hookTimeout: 600_000,
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
})
