import { describe, expect, it } from 'vitest'
import { assertPublicDestination, assertStillPublic, MIN_DNS_TTL_S } from './guard.ts'
import { staticResolver } from './test-helpers.ts'

const signal = new AbortController().signal
const resolver = staticResolver({
  'hooks.example.com': ['93.184.216.34', '2606:2800:220:1::1'],
  'rebind.example.com': ['93.184.216.34', '10.0.0.5'],
  'metadata.example.com': ['169.254.169.254'],
  'v6local.example.com': ['fd00::1'],
  'short.example.com': [{ address: '93.184.216.34', ttl: MIN_DNS_TTL_S - 1 }],
  'edge.example.com': [{ address: '93.184.216.34', ttl: MIN_DNS_TTL_S }],
  'mixed.example.com': [{ address: '93.184.216.34', ttl: 300 }, { address: '93.184.216.35', ttl: 5 }],
})

describe('assertPublicDestination', () => {
  it('allows an https URL on 443 whose every address is public', async () => {
    const url = await assertPublicDestination('https://hooks.example.com/fluss?x=1', resolver, signal)
    expect(url.hostname).toBe('hooks.example.com')
    await assertPublicDestination('https://hooks.example.com:443/', resolver, signal)
  })

  it('allows an answer whose TTL is exactly the minimum', async () => {
    await expect(assertPublicDestination('https://edge.example.com/', resolver, signal)).resolves.toBeInstanceOf(URL)
  })

  it.each([
    ['plain http', 'http://hooks.example.com/'],
    ['another scheme', 'ftp://hooks.example.com/'],
    ['user info', 'https://user:pass@hooks.example.com/'],
    ['not a URL', 'hooks.example.com'],
    ['a port other than 443', 'https://hooks.example.com:8443/'],
    ['port 80 over https', 'https://hooks.example.com:80/'],
    ['a public IPv4 literal', 'https://1.1.1.1/'],
    ['a public IPv6 literal', 'https://[2606:4700::1111]/'],
    ['loopback', 'https://127.0.0.1/'],
    ['loopback in decimal', 'https://2130706433/'],
    ['loopback in hex', 'https://0x7f.0.0.1/'],
    ['cloud metadata', 'https://169.254.169.254/latest/meta-data/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['IPv4-mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]/'],
  ])('refuses %s as invalid_url without resolving', async (_name, url) => {
    const r = staticResolver({})
    await expect(assertPublicDestination(url, r, signal)).rejects.toMatchObject({ code: 'invalid_url' })
    expect(r.calls).toEqual([])
  })

  it.each([
    ['localhost', 'https://localhost/'],
    ['a .localhost name', 'https://api.localhost/'],
    ['a .internal name', 'https://metadata.google.internal/'],
    ['a dotless name', 'https://intranet/'],
    ['a trailing-dot local name', 'https://localhost./'],
    ['a name with any private address', 'https://rebind.example.com/'],
    ['a name pointing at metadata', 'https://metadata.example.com/'],
    ['a name pointing at unique-local IPv6', 'https://v6local.example.com/'],
  ])('refuses %s as destination_blocked', async (_name, url) => {
    await expect(assertPublicDestination(url, resolver, signal)).rejects.toMatchObject({ code: 'destination_blocked' })
  })

  it.each([
    ['a short TTL', 'https://short.example.com/'],
    ['one short TTL among long ones', 'https://mixed.example.com/'],
  ])('refuses %s as destination_unstable', async (_name, url) => {
    await expect(assertPublicDestination(url, resolver, signal)).rejects.toMatchObject({ code: 'destination_unstable' })
  })

  it('refuses a name with no addresses', async () => {
    await expect(assertPublicDestination('https://nothing.example.com/', resolver, signal)).rejects.toMatchObject({ code: 'destination_unresolvable' })
  })

  it('never puts the path or query in the error', async () => {
    const err = await assertPublicDestination('https://metadata.example.com/hook?token=abc', resolver, signal).catch((e: unknown) => e)
    expect(String((err as Error).message)).not.toContain('token')
  })
})

describe('assertStillPublic', () => {
  it('passes when the name still resolves only to public addresses', async () => {
    await expect(assertStillPublic(new URL('https://hooks.example.com/'), resolver, signal)).resolves.toBeUndefined()
  })

  it('throws destination_changed when it now resolves to a private address', async () => {
    await expect(assertStillPublic(new URL('https://metadata.example.com./'), resolver, signal)).rejects.toMatchObject({ code: 'destination_changed', host: 'metadata.example.com' })
  })

  it('ignores a failed lookup', async () => {
    const broken = { resolve: async () => { throw new Error('doh down') } }
    await expect(assertStillPublic(new URL('https://hooks.example.com/'), broken, signal)).resolves.toBeUndefined()
  })
})
