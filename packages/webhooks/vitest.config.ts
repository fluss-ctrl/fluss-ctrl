import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'webhooks',
    include: ['src/**/*.test.ts'],
  },
})
