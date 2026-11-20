import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'conformance',
    include: ['src/**/*.test.ts'],
  },
})
