import { describe, expect, it } from 'vitest'
import { DEFAULT_TIMEOUTS, isProviderError, PROVIDER_ERROR_CODES, ProviderError } from './provider.ts'

describe('ProviderError', () => {
  it('carries a stable code, the ambiguity flag and the vendor detail', () => {
    const err = new ProviderError('timeout', 'no reply', { ambiguous: true, detail: { raw: 'x' } })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ProviderError')
    expect(err.code).toBe('timeout')
    expect(err.ambiguous).toBe(true)
    expect(err.detail).toEqual({ raw: 'x' })
    expect(isProviderError(err)).toBe(true)
  })

  it('is not ambiguous unless said so', () => {
    const err = new ProviderError('offline', 'unit offline')
    expect(err.ambiguous).toBe(false)
    expect(err.detail).toBeUndefined()
  })

  it('is told apart from other errors', () => {
    expect(isProviderError(new Error('x'))).toBe(false)
    expect(isProviderError({ code: 'offline' })).toBe(false)
  })

  it('has exactly the SPEC §10 codes', () => {
    expect([...PROVIDER_ERROR_CODES].sort()).toEqual(['offline', 'rate_limited', 'timeout', 'unauthorised', 'unsupported', 'vendor_error'])
  })
})

describe('DEFAULT_TIMEOUTS', () => {
  it('matches SPEC §7.1 and §7.2', () => {
    expect(DEFAULT_TIMEOUTS).toEqual({ send_s: 8, confirm_window_s: { trigger: 10, open: 10, close: 45 } })
  })
})
