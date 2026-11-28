import { describe, expect, it } from 'vitest'
import { cachingProblem, configUrl } from './check-hyperdrive.mjs'

const ok = (caching) => ({ success: true, errors: [], result: { id: 'b'.repeat(32), name: 'fluss-ctrl-staging', ...(caching === undefined ? {} : { caching }) } })

describe('cachingProblem', () => {
  it('passes only when caching is explicitly disabled', () => {
    expect(cachingProblem(ok({ disabled: true }))).toBeNull()
  })

  it.each([
    ['caching enabled', ok({ disabled: false })],
    ['caching settings without disabled', ok({ max_age: 60 })],
    ['no caching settings (Hyperdrive caches by default)', ok(undefined)],
  ])('fails with %s', (_, body) => {
    expect(cachingProblem(body)).toMatch(/query caching is ON for Hyperdrive config "fluss-ctrl-staging"/)
  })

  it.each([
    ['an API error', { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }],
    ['a non-JSON body', null],
    ['a result that is not an object', { success: true, result: null }],
  ])('fails on %s', (_, body) => {
    expect(cachingProblem(body)).toMatch(/did not return the Hyperdrive config/)
  })

  it('names the API error code without its message', () => {
    expect(cachingProblem({ success: false, errors: [{ code: 10000, message: 'secret-ish detail' }] })).toBe('the Cloudflare API did not return the Hyperdrive config (error 10000)')
  })
})

describe('configUrl', () => {
  it('builds the Hyperdrive config URL from validated ids', () => {
    expect(configUrl('a'.repeat(32), 'b'.repeat(32))).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/hyperdrive/configs/${'b'.repeat(32)}`)
  })

  it.each([
    ['a missing account id', undefined, 'b'.repeat(32), /CLOUDFLARE_ACCOUNT_ID/],
    ['a path in the account id', '../x', 'b'.repeat(32), /CLOUDFLARE_ACCOUNT_ID/],
    ['a missing Hyperdrive id', 'a'.repeat(32), '', /HYPERDRIVE_ID/],
  ])('refuses %s', (_, account, hyperdrive, message) => {
    expect(() => configUrl(account, hyperdrive)).toThrow(message)
  })
})
