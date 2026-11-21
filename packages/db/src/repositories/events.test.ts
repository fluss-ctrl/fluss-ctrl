import { describe, expect, it } from 'vitest'
import { testId } from '../test/ids.ts'
import { recordedAtFromId } from './events.ts'

describe('recordedAtFromId', () => {
  it('reads the UUIDv7 time', () => {
    const ms = Date.UTC(2026, 10, 21, 6, 56, 29, 123)
    expect(recordedAtFromId(testId('evt', ms)).toISOString()).toBe('2026-11-21T06:56:29.123Z')
  })

  it('refuses ids that are not events', () => {
    expect(() => recordedAtFromId(testId('cmd'))).toThrow(TypeError)
    expect(() => recordedAtFromId('evt_nope')).toThrow(TypeError)
  })
})
