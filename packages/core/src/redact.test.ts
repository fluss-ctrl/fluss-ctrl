import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { newId } from './ids.ts'
import { REDACTED, redact, redactString } from './redact.ts'

// A phone number in one of the shapes people write: optional +, 9 to 15 digits, with spaces,
// dashes, dots or parentheses between groups.
const phone = fc.tuple(
  fc.boolean(),
  fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 15 }),
  fc.array(fc.constantFrom('', '', '', ' ', '-', '.', ') ', ' ('), { minLength: 15, maxLength: 15 })
).map(([plus, digits, seps]) => ({
  digits: digits.join(''),
  text: (plus ? '+' : '') + digits.map((d, i) => (i === 0 ? `${d}` : `${seps[i]}${d}`)).join(''),
}))

const digitsOnly = (s: string): string => s.replace(/\D/g, '')

describe('redactString', () => {
  it('redacts phone numbers embedded anywhere in random text (property)', () => {
    fc.assert(fc.property(fc.string(), phone, fc.string(), (before, p, after) => {
      const out = redactString(`${before}${p.text}${after}`)
      expect(digitsOnly(out)).not.toContain(p.digits)
    }))
  })

  it('redacts bearer and basic credentials (property)', () => {
    const token = fc.stringMatching(/^[\w.~+/=-]{8,64}$/)
    fc.assert(fc.property(fc.string(), fc.constantFrom('Bearer', 'bearer', 'Basic'), token, fc.string(), (before, scheme, t, after) => {
      const out = redactString(`${before} ${scheme} ${t} ${after}`)
      expect(out).not.toContain(` ${t} `)
      expect(out).toContain(`${scheme} ${REDACTED}`)
    }))
  })

  it('redacts JWTs and webhook secrets', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl'
    expect(redactString(`token=${jwt}`)).toBe(`token=${REDACTED}`)
    expect(redactString('secret whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw')).toBe(`secret ${REDACTED}`)
  })

  it('leaves ids, timestamps and short numbers alone', () => {
    const id = newId('cmd')
    const line = `${id} at 2026-11-20T12:00:00Z took 1234 ms, attempt 3`
    expect(redactString(line)).toBe(line)
  })

  it('leaves ids alone even when their digit groups look like a phone number', () => {
    const id = 'dev_01234567-8901-7234-8567-890123456789'
    expect(redactString(`device ${id} call 0825551234`)).toBe(`device ${id} call ${REDACTED}`)
  })
})

describe('redact', () => {
  it('replaces values under sensitive keys whole, at any depth', () => {
    const input = {
      msg: 'link_started',
      client_secret: 'abc',
      headers: { Authorization: 'Bearer abc', 'x-api-key': 'k' },
      subject: { phone: '+27 82 555 1234', external_id: 'u-1' },
      list: [{ password: 'p' }],
      token_hint: null,
    }
    expect(redact(input)).toEqual({
      msg: 'link_started',
      client_secret: REDACTED,
      headers: { Authorization: REDACTED, 'x-api-key': REDACTED },
      subject: { phone: REDACTED, external_id: 'u-1' },
      list: [{ password: REDACTED }],
      token_hint: null,
    })
  })

  it('scans strings under other keys and keeps non-strings', () => {
    expect(redact({ note: 'call +27825551234', count: 3, ok: true, nothing: undefined }))
      .toEqual({ note: `call ${REDACTED}`, count: 3, ok: true, nothing: undefined })
  })

  it('does not mutate its input', () => {
    const input = { secret: 's', nested: { note: 'call 0825551234' } }
    const copy = structuredClone(input)
    redact(input)
    expect(input).toEqual(copy)
  })

  it('renders errors as name and redacted message', () => {
    expect(redact({ err: new TypeError('bad number 0825551234') })).toEqual({ err: { name: 'TypeError', message: `bad number ${REDACTED}` } })
  })

  it('survives cycles', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(redact(a)).toEqual({ name: 'a', self: '[Circular]' })
  })

  it('handles primitives', () => {
    expect(redact('0825551234')).toBe(REDACTED)
    expect(redact(7)).toBe(7)
    expect(redact(null)).toBe(null)
  })
})
