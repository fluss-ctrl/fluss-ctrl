import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { testId } from '../test/ids.ts'
import { clampLimit, DEFAULT_LIMIT, EVENT_ID_MAX_AGE_MS, EVENT_SETTLE_MS, MAX_LIMIT, recordedAtForInsert, recordedAtFromId, StaleEventIdError } from './events.ts'

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

describe('recordedAtForInsert', () => {
  const ms = Date.UTC(2026, 10, 21, 6, 56, 29, 123)
  const id = testId('evt', ms)

  it('gives the time in the id when the id is fresh', () => {
    expect(recordedAtForInsert(id, new Date(ms)).getTime()).toBe(ms)
    expect(recordedAtForInsert(id, new Date(ms + EVENT_ID_MAX_AGE_MS)).getTime()).toBe(ms)
  })

  it('refuses an id minted more than 1 s before the insert', () => {
    expect(() => recordedAtForInsert(id, new Date(ms + EVENT_ID_MAX_AGE_MS + 1))).toThrow(StaleEventIdError)
    expect(() => recordedAtForInsert(id, new Date(ms + 60_000))).toThrow('minted 60000 ms before its insert')
  })

  it('lets through an id ahead of the clock, as after a clock step back', () => {
    expect(recordedAtForInsert(id, new Date(ms - 2000)).getTime()).toBe(ms)
  })

  it('refuses a clock reading that is not a time, and an id that is not an event', () => {
    expect(() => recordedAtForInsert(id, new Date(Number.NaN))).toThrow(StaleEventIdError)
    expect(() => recordedAtForInsert(testId('cmd', ms), new Date(ms))).toThrow(TypeError)
  })

  it('leaves most of the settle window to the transaction', () => {
    expect(EVENT_ID_MAX_AGE_MS).toBeLessThan(EVENT_SETTLE_MS / 2)
  })

  it('accepts an id exactly when it is no more than 1 s old', () => {
    const at = fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2100, 0, 1) })
    fc.assert(fc.property(at, fc.integer({ min: -10_000, max: 10_000 }), (minted, age) => {
      const fresh = testId('evt', minted)
      if (age <= EVENT_ID_MAX_AGE_MS) expect(recordedAtForInsert(fresh, new Date(minted + age)).getTime()).toBe(minted)
      else expect(() => recordedAtForInsert(fresh, new Date(minted + age))).toThrow(StaleEventIdError)
    }))
  })
})

describe('clampLimit', () => {
  it('defaults anything that is not a finite number', () => {
    for (const v of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampLimit(v)).toBe(DEFAULT_LIMIT)
    }
  })

  it('keeps finite values between 1 and the maximum', () => {
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(-5)).toBe(1)
    expect(clampLimit(2.9)).toBe(2)
    expect(clampLimit(10_000)).toBe(MAX_LIMIT)
  })
})
