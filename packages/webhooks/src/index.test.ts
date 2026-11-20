import { describe, expect, it } from 'vitest'
import { packageName } from './index.ts'

describe('@flussctrl/webhooks', () => {
  it('is wired into the workspace', () => {
    expect(packageName).toBe('@flussctrl/webhooks')
  })
})
