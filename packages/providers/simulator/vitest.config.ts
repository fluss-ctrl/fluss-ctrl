import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'provider-simulator',
    include: ['src/**/*.test.ts'],
  },
})
