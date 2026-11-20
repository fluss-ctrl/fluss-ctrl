import { describe, expect, it } from 'vitest'
import { manualClock, packageName, ProviderError } from './index.ts'

describe('@flussctrl/core', () => {
  it('is wired into the workspace', () => {
    expect(packageName).toBe('@flussctrl/core')
    expect(typeof manualClock).toBe('function')
    expect(typeof ProviderError).toBe('function')
  })
})
