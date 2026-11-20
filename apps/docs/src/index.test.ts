import { describe, expect, it } from 'vitest'
import { packageName } from './index.ts'

describe('@flussctrl/docs', () => {
  it('is wired into the workspace', () => {
    expect(packageName).toBe('@flussctrl/docs')
  })
})
