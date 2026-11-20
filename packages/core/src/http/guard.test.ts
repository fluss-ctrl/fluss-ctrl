import { describe, expect, it } from 'vitest'
import { assertPublicDestination } from './guard.ts'
import { staticResolver } from './test-helpers.ts'

const signal = new AbortController().signal
const resolver = staticResolver({
  'hooks.example.com': ['93.184.216.34', '2606:2800:220:1::1'],
  'rebind.example.com': ['93.184.216.34', '10.0.0.5'],
  'metadata.example.com': ['169.254.169.254'],
  'v6local.example.com': ['fd00::1'],
})

describe('assertPublicDestination', () => {
  it('allows an https URL whose every address is public', async () => {
    const url = await assertPublicDestination('https://hooks.example.com/fluss?x=1', resolver, signal)
    expect(url.hostname).toBe('hooks.example.com')
  })

  it('allows a public IP literal without resolving', async () => {
    const r = staticResolver({})
    await assertPublicDestination('https://1.1.1.1/', r, signal)
    await assertPublicDestination('https://[2606:4700::1111]/', r, signal)
    expect(r.calls).toEqual([])
  })

  it.each([
    ['plain http', 'http://hooks.example.com/'],
    ['another scheme', 'ftp://hooks.example.com/'],
    ['user info', 'https://user:pass@hooks.example.com/'],
    ['not a URL', 'hooks.example.com'],
  ])('refuses %s as invalid_url', async (_name, url) => {
    await expect(assertPublicDestination(url, resolver, signal)).rejects.toMatchObject({ code: 'invalid_url' })
  })

  it.each([
    ['loopback', 'https://127.0.0.1/'],
    ['loopback in decimal', 'https://2130706433/'],
    ['loopback in hex', 'https://0x7f.0.0.1/'],
    ['private', 'https://192.168.1.10:8443/'],
    ['cloud metadata', 'https://169.254.169.254/latest/meta-data/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['IPv4-mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]/'],
    ['localhost', 'https://localhost/'],
    ['a .localhost name', 'https://api.localhost/'],
    ['a .internal name', 'https://metadata.google.internal/'],
    ['a dotless name', 'https://intranet/'],
    ['a name with any private address', 'https://rebind.example.com/'],
    ['a name pointing at metadata', 'https://metadata.example.com/'],
    ['a name pointing at unique-local IPv6', 'https://v6local.example.com/'],
    ['a trailing-dot local name', 'https://localhost./'],
  ])('refuses %s as destination_blocked', async (_name, url) => {
    await expect(assertPublicDestination(url, resolver, signal)).rejects.toMatchObject({ code: 'destination_blocked' })
  })

  it('refuses a name with no addresses', async () => {
    await expect(assertPublicDestination('https://nothing.example.com/', resolver, signal)).rejects.toMatchObject({ code: 'destination_unresolvable' })
  })

  it('never puts the path or query in the error', async () => {
    const err = await assertPublicDestination('https://127.0.0.1/hook?token=abc', resolver, signal).catch((e: unknown) => e)
    expect(String((err as Error).message)).not.toContain('token')
  })
})
