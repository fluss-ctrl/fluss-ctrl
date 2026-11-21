import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeEventCursor, encodeEventCursor, InvalidCursorError } from './cursor.ts'
import { testId } from './test/ids.ts'

const cursorArb = fc.record({
  recordedAt: fc.date({ min: new Date(Date.UTC(2020, 0, 1)), max: new Date(Date.UTC(2100, 0, 1)), noInvalidDate: true }),
  ms: fc.integer({ min: 0, max: 2 ** 47 }),
}).map(({ recordedAt, ms }) => ({ recordedAt, id: testId('evt', ms) }))

describe('event cursors', () => {
  it('round-trip', () => {
    fc.assert(fc.property(cursorArb, (c) => {
      const back = decodeEventCursor(encodeEventCursor(c))
      expect(back.id).toBe(c.id)
      expect(back.recordedAt.getTime()).toBe(c.recordedAt.getTime())
    }))
  })

  it('are URL-safe', () => {
    fc.assert(fc.property(cursorArb, (c) => {
      expect(encodeEventCursor(c)).toMatch(/^[A-Za-z0-9_-]+$/)
    }))
  })

  it('reject anything else with InvalidCursorError and nothing else', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      try {
        decodeEventCursor(s)
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidCursorError)
      }
    }))
  })

  it('reject well-formed JSON with the wrong contents', () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    for (const bad of [null, 1, [], {}, { r: '2026-11-21T00:00:00.000Z' }, { r: 'x', i: testId('evt') },
      { r: '2026-11-21T00:00:00.000Z', i: testId('dev') }, { r: '2026-02-30T00:00:00.000Z', i: testId('evt') }]) {
      expect(() => decodeEventCursor(enc(bad))).toThrow(InvalidCursorError)
    }
    expect(() => decodeEventCursor(Buffer.from([0xff, 0xfe]).toString('base64url'))).toThrow(InvalidCursorError)
  })
})
