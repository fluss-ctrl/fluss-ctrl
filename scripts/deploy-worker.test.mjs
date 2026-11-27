import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { healthy, isFirstDeploy, overrideHeader, parseCanary, smoke, soleVersion, versionIdFromOutput } from './deploy-worker.mjs'

const v1 = '11111111-1111-4111-8111-111111111111'
const v2 = '22222222-2222-4222-8222-222222222222'

describe('versionIdFromOutput', () => {
  it('takes the last version id of the requested type', () => {
    const out = [
      JSON.stringify({ type: 'wrangler-session', version: 1 }),
      JSON.stringify({ type: 'version-upload', version_id: v1 }),
      '',
      JSON.stringify({ type: 'version-upload', version_id: v2 }),
      JSON.stringify({ type: 'version-deploy', version_traffic: {} }),
    ].join('\n')
    expect(versionIdFromOutput(out, 'version-upload')).toBe(v2)
  })

  it('fails when Wrangler reported no id, or a malformed one', () => {
    expect(() => versionIdFromOutput(JSON.stringify({ type: 'deploy', version_id: null }), 'deploy')).toThrow(/no version id/)
    expect(() => versionIdFromOutput(JSON.stringify({ type: 'deploy', version_id: 'x' }), 'deploy')).toThrow(/no version id/)
    expect(() => versionIdFromOutput('', 'deploy')).toThrow(/no version id/)
  })
})

describe('soleVersion', () => {
  it('returns the version serving 100%', () => {
    expect(soleVersion({ versions: [{ version_id: v1, percentage: 100 }] })).toBe(v1)
  })

  it.each([
    ['a split left by an earlier run', { versions: [{ version_id: v1, percentage: 90 }, { version_id: v2, percentage: 10 }] }],
    ['no versions', { versions: [] }],
    ['a malformed response', {}],
  ])('refuses %s', (_, deployment) => {
    expect(() => soleVersion(deployment)).toThrow(/not one version at 100%/)
  })
})

describe('isFirstDeploy', () => {
  it('recognises a Worker with no deployment', () => {
    expect(isFirstDeploy('✘ [ERROR] The Worker fluss-ctrl-api has no deployments.')).toBe(true)
    expect(isFirstDeploy('A request to the Cloudflare API failed. This Worker does not exist. [code: 10007]')).toBe(true)
  })

  it('treats any other failure as a real error', () => {
    expect(isFirstDeploy('Authentication error [code: 10000]')).toBe(false)
    expect(isFirstDeploy('')).toBe(false)
  })
})

describe('parseCanary', () => {
  it('accepts integers from 1 to 100', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 100 }), (n) => {
      expect(parseCanary(String(n))).toBe(n)
    }))
  })

  it.each(['0', '101', '10.5', 'ten', ''])('refuses %j', (value) => {
    expect(() => parseCanary(value)).toThrow(/--canary/)
  })
})

describe('overrideHeader', () => {
  it('pins the request to one version of the named Worker', () => {
    expect(overrideHeader('fluss-ctrl-api', v2)).toEqual({ 'Cloudflare-Workers-Version-Overrides': `fluss-ctrl-api="${v2}"` })
  })
})

describe('healthy', () => {
  it('accepts only 200 with {"status":"ok"}', () => {
    expect(healthy(200, { status: 'ok' })).toBe(true)
    expect(healthy(200, { status: 'degraded' })).toBe(false)
    expect(healthy(503, { status: 'ok' })).toBe(false)
    expect(healthy(200, null)).toBe(false)
  })
})

describe('smoke', () => {
  const response = (status, body) => ({ status, json: async () => body })
  const noWait = async () => {}

  it('passes on the first healthy answer and sends the override header', async () => {
    const calls = []
    const fetchFn = async (url, init) => {
      calls.push([String(url), init.headers])
      return calls.length < 3 ? response(503, null) : response(200, { status: 'ok' })
    }
    const result = await smoke('https://api.example.test', { h: '1' }, { attempts: 5, fetchFn, wait: noWait })
    expect(result).toEqual({ ok: true, detail: 'HTTP 200 after 3 attempt(s)' })
    expect(calls[0]).toEqual(['https://api.example.test/health', { h: '1' }])
  })

  it('fails after the last attempt, reporting the last status', async () => {
    const fetchFn = async () => response(500, { status: 'ok' })
    expect(await smoke('https://api.example.test', {}, { attempts: 3, fetchFn, wait: noWait })).toEqual({ ok: false, detail: 'HTTP 500 after 3 attempts' })
  })

  it('treats a network error as a failed attempt', async () => {
    const fetchFn = async () => { throw new TypeError('fetch failed') }
    expect(await smoke('https://api.example.test', {}, { attempts: 2, fetchFn, wait: noWait })).toEqual({ ok: false, detail: 'TypeError after 2 attempts' })
  })
})
