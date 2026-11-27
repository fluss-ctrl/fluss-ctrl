import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { healthy, isFirstDeploy, overrideHeader, parseCanary, parseVersionId, smoke, soleVersion, versionIdFromOutput } from './deploy-worker.mjs'

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
  it('accepts only 200 with status ok from the expected version', () => {
    expect(healthy(200, { status: 'ok', version: v2 }, v2)).toBe(true)
    expect(healthy(200, { status: 'ok', version: v1 }, v2)).toBe(false)
    expect(healthy(200, { status: 'ok' }, v2)).toBe(false)
    expect(healthy(200, { status: 'degraded', version: v2 }, v2)).toBe(false)
    expect(healthy(503, { status: 'ok', version: v2 }, v2)).toBe(false)
    expect(healthy(200, null, v2)).toBe(false)
  })
})

describe('parseVersionId', () => {
  it('accepts a version UUID and refuses anything else', () => {
    expect(parseVersionId(v1)).toBe(v1)
    expect(() => parseVersionId('latest')).toThrow(/--restore/)
    expect(() => parseVersionId(undefined)).toThrow(/--restore/)
  })
})

describe('smoke', () => {
  const response = (status, body) => ({ status, json: async () => body })
  const noWait = async () => {}

  it('passes on the first answer from the expected version and sends the override header', async () => {
    const calls = []
    const fetchFn = async (url, init) => {
      calls.push([String(url), init.headers, init.signal])
      if (calls.length === 1) return response(503, null)
      if (calls.length === 2) return response(200, { status: 'ok', version: v1 })
      return response(200, { status: 'ok', version: v2 })
    }
    const result = await smoke('https://api.example.test', v2, { h: '1' }, { attempts: 5, fetchFn, wait: noWait })
    expect(result).toEqual({ ok: true, detail: `HTTP 200 from ${v2} after 3 attempt(s)` })
    expect(calls[0].slice(0, 2)).toEqual(['https://api.example.test/health', { h: '1' }])
    expect(calls[0][2]).toBeInstanceOf(AbortSignal)
  })

  it('never counts an answer from the old version, and says which version answered', async () => {
    const fetchFn = async () => response(200, { status: 'ok', version: v1 })
    expect(await smoke('https://api.example.test', v2, {}, { attempts: 3, fetchFn, wait: noWait })).toEqual({ ok: false, detail: `answered by version ${v1} after 3 attempts` })
  })

  it('fails after the last attempt, reporting the last status', async () => {
    const fetchFn = async () => response(500, { status: 'ok', version: v2 })
    expect(await smoke('https://api.example.test', v2, {}, { attempts: 3, fetchFn, wait: noWait })).toEqual({ ok: false, detail: 'HTTP 500 after 3 attempts' })
  })

  it('treats a network error as a failed attempt', async () => {
    const fetchFn = async () => { throw new TypeError('fetch failed') }
    expect(await smoke('https://api.example.test', v2, {}, { attempts: 2, fetchFn, wait: noWait })).toEqual({ ok: false, detail: 'TypeError after 2 attempts' })
  })

  it('bounds a stalled request or body with the timeout, so retries still run out', async () => {
    const stall = (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const stalledRequest = async (_url, init) => stall(init.signal)
    expect(await smoke('https://api.example.test', v2, {}, { attempts: 2, timeoutMs: 20, fetchFn: stalledRequest, wait: noWait }))
      .toEqual({ ok: false, detail: 'TimeoutError after 2 attempts' })
    const stalledBody = async (_url, init) => ({ status: 200, json: () => stall(init.signal) })
    expect(await smoke('https://api.example.test', v2, {}, { attempts: 2, timeoutMs: 20, fetchFn: stalledBody, wait: noWait }))
      .toEqual({ ok: false, detail: 'TimeoutError after 2 attempts' })
  })
})
