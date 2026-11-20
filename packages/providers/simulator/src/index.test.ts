import { describe, expect, it } from 'vitest'
import { packageName } from './index.ts'

describe('@flussctrl/provider-simulator', () => {
  it('is wired into the workspace', () => {
    expect(packageName).toBe('@flussctrl/provider-simulator')
  })
})
