import { defineConfig } from 'vitest/config'

// Runs every workspace's own vitest.config.ts as a project. `pnpm test:unit` runs this with
// coverage; `pnpm --filter <pkg> test` runs one workspace on its own.
export default defineConfig({
  test: {
    // Match config files, not folders: `packages/*` would also match `packages/providers`
    // itself and run the provider tests twice.
    projects: ['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts', 'packages/providers/*/vitest.config.ts'],
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**', 'packages/*/src/**', 'packages/providers/*/src/**'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      // Coverage is a guide everywhere except packages/core, where a missed branch can open or
      // lock a gate (SPEC §11, PLAN §13 exception 2). This floor is never lowered to pass a PR.
      thresholds: {
        'packages/core/src/**': {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
})
