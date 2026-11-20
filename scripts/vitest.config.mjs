import { defineProject } from 'vitest/config'

// Tests for the repository's own tooling scripts (CI helpers).
export default defineProject({
  test: {
    name: 'scripts',
    include: ['**/*.test.mjs'],
  },
})
