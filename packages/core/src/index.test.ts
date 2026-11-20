import { describe, expect, it } from 'vitest'
import { packageName } from './index.ts'

describe('@flussctrl/core', () => {
  it('is wired into the workspace', () => {
    expect(packageName).toBe('@flussctrl/core')
  })
})
