import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createHttpClient, type HttpClient, type RequestOnceOptions } from './client.ts'
import type { ResolvedAddress } from './resolver.ts'
import { hangingFetch, staticResolver } from './test-helpers.ts'

const resolver = staticResolver({ 'api.vendor.example': ['93.184.216.34'] })

function recordingFetch (responses: Array<Response | Error>) {
  const calls: Array<{ url: string, init: RequestInit | undefined }> = []
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    const next = responses.shift()
    if (next === undefined) throw new Error('unexpected extra request')
    if (next instanceof Error) throw next
    return next
  }
  return { fetch, calls }
}

describe('requestOnce', () => {
  it('sends the request without following redirects', async () => {
    const { fetch, calls } = recordingFetch([new Response('ok')])
    const client = createHttpClient({ fetch, resolver })
    const res = await client.requestOnce('https://api.vendor.example/commands', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.init).toMatchObject({ method: 'POST', body: '{}', redirect: 'manual' })
  })

  it('returns a redirect to the caller instead of following it', async () => {
    const { fetch, calls } = recordingFetch([new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })])
    const res = await createHttpClient({ fetch, resolver }).requestOnce('https://api.vendor.example/')
    expect(res.status).toBe(302)
    expect(calls).toHaveLength(1)
  })

  it('refuses a private destination before anything is sent', async () => {
    const { fetch, calls } = recordingFetch([])
    const client = createHttpClient({ fetch, resolver: staticResolver({ 'evil.example': ['10.0.0.1'] }) })
    await expect(client.requestOnce('https://evil.example/', { method: 'POST' })).rejects.toMatchObject({ code: 'destination_blocked' })
    expect(calls).toHaveLength(0)
  })

  it('fails a request whose name rebinds to a private address after it was sent', async () => {
    const rebinding = staticResolver({
      'rebind.example': (call) => [{ address: call === 1 ? '93.184.216.34' : '169.254.169.254', ttl: 300 }],
    })
    const { fetch, calls } = recordingFetch([new Response('secret metadata')])
    await expect(createHttpClient({ fetch, resolver: rebinding }).requestOnce('https://rebind.example/'))
      .rejects.toMatchObject({ code: 'destination_changed', host: 'rebind.example' })
    expect(calls).toHaveLength(1)
  })

  it('keeps the response when the second lookup itself fails', async () => {
    let n = 0
    const flaky = {
      resolve: async () => {
        n++
        if (n > 1) throw new Error('doh down')
        return [{ address: '93.184.216.34', ttl: 300 }]
      },
    }
    const { fetch } = recordingFetch([new Response('ok')])
    expect((await createHttpClient({ fetch, resolver: flaky }).requestOnce('https://api.vendor.example/')).status).toBe(200)
  })

  it('fails a HEAD request when the deadline passes during the second lookup', async () => {
    let n = 0
    const resolverHangingSecond = {
      resolve: (_h: string, signal: AbortSignal) => {
        n++
        if (n === 1) return Promise.resolve([{ address: '93.184.216.34', ttl: 300 }])
        return new Promise<ResolvedAddress[]>((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        })
      },
    }
    const { fetch } = recordingFetch([new Response(null)])
    await expect(createHttpClient({ fetch, resolver: resolverHangingSecond }).requestIdempotent('https://api.vendor.example/', { method: 'HEAD', timeoutMs: 20 }))
      .rejects.toMatchObject({ code: 'timeout' })
  })

  it('cancels the other DNS query when one fails', async () => {
    let aaaaAborted = false
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      if (new URL(url).searchParams.get('type') === 'A') return new Response('nope', { status: 500 })
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { aaaaAborted = true; reject(new DOMException('aborted', 'AbortError')) }, { once: true })
      })
    }
    await expect(createHttpClient({ fetch, defaultTimeoutMs: 5_000 }).requestOnce('https://hooks.example.com/'))
      .rejects.toMatchObject({ code: 'dns_failed' })
    expect(aaaaAborted).toBe(true)
  })

  it('lets the caller cancel reading the body after the response arrives', async () => {
    const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
      const body = new ReadableStream<Uint8Array>({
        start (controller) {
          controller.enqueue(new TextEncoder().encode('partial'))
          init?.signal?.addEventListener('abort', () => { controller.error(new DOMException('aborted', 'AbortError')) }, { once: true })
        },
      })
      return new Response(body)
    }
    const caller = new AbortController()
    const res = await createHttpClient({ fetch, resolver, defaultTimeoutMs: 5_000 }).requestOnce('https://api.vendor.example/', { signal: caller.signal })
    const started = Date.now()
    const reading = res.text()
    caller.abort()
    await expect(reading).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('never retries, even on a network error or a 503', async () => {
    const fail = recordingFetch([new TypeError('reset')])
    await expect(createHttpClient({ fetch: fail.fetch, resolver }).requestOnce('https://api.vendor.example/', { method: 'POST' }))
      .rejects.toMatchObject({ code: 'network_error', host: 'api.vendor.example' })
    expect(fail.calls).toHaveLength(1)

    const busy = recordingFetch([new Response(null, { status: 503 })])
    expect((await createHttpClient({ fetch: busy.fetch, resolver }).requestOnce('https://api.vendor.example/', { method: 'POST' })).status).toBe(503)
    expect(busy.calls).toHaveLength(1)
  })

  it('has no retry option a caller can turn on', () => {
    expectTypeOf<RequestOnceOptions>().not.toHaveProperty('retries')
    expectTypeOf<Parameters<HttpClient['requestOnce']>[1]>().toEqualTypeOf<RequestOnceOptions | undefined>()
    const { fetch, calls } = recordingFetch([new TypeError('reset')])
    const client = createHttpClient({ fetch, resolver })
    // Even an untyped caller cannot sneak one in: the option is ignored.
    const sneaky = { method: 'POST', retries: 2 } as RequestOnceOptions
    return expect(client.requestOnce('https://api.vendor.example/', sneaky)).rejects.toMatchObject({ code: 'network_error' })
      .then(() => { expect(calls).toHaveLength(1) })
  })

  it('times out a request that does not answer', async () => {
    const client = createHttpClient({ fetch: hangingFetch(), resolver })
    await expect(client.requestOnce('https://api.vendor.example/', { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' })
  })

  it('applies the deadline to DNS resolution too', async () => {
    const slowResolver = {
      resolve: (_h: string, signal: AbortSignal) => new Promise<ResolvedAddress[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      }),
    }
    const { fetch, calls } = recordingFetch([])
    await expect(createHttpClient({ fetch, resolver: slowResolver, defaultTimeoutMs: 20 }).requestOnce('https://api.vendor.example/'))
      .rejects.toMatchObject({ code: 'timeout' })
    expect(calls).toHaveLength(0)
  })

  it('reports the caller aborting as aborted', async () => {
    const controller = new AbortController()
    const pending = createHttpClient({ fetch: hangingFetch(), resolver }).requestOnce('https://api.vendor.example/', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })

  it('reports an already-aborted signal as aborted without sending', async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetch, calls } = recordingFetch([])
    const slowResolver = {
      resolve: (_h: string, signal: AbortSignal) => signal.aborted ? Promise.reject(new Error('aborted')) : Promise.resolve([{ address: '93.184.216.34', ttl: 300 }]),
    }
    await expect(createHttpClient({ fetch, resolver: slowResolver }).requestOnce('https://api.vendor.example/', { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'aborted' })
    expect(calls).toHaveLength(0)
  })

  it('rejects a non-positive timeout', async () => {
    const { fetch } = recordingFetch([])
    await expect(createHttpClient({ fetch, resolver }).requestOnce('https://api.vendor.example/', { timeoutMs: 0 })).rejects.toBeInstanceOf(RangeError)
  })

  it('resolves through DNS-over-HTTPS by default', async () => {
    const seen: string[] = []
    const fetch = async (url: string): Promise<Response> => {
      seen.push(new URL(url).host)
      if (url.startsWith('https://cloudflare-dns.com/')) {
        const type = new URL(url).searchParams.get('type')
        return Response.json(type === 'A' ? { Status: 0, Answer: [{ type: 1, data: '93.184.216.34', TTL: 300 }] } : { Status: 0 })
      }
      return new Response('ok')
    }
    expect((await createHttpClient({ fetch }).requestOnce('https://hooks.example.com/')).status).toBe(200)
    expect(seen).toEqual(['cloudflare-dns.com', 'cloudflare-dns.com', 'hooks.example.com', 'cloudflare-dns.com', 'cloudflare-dns.com'])
  })
})

describe('requestIdempotent', () => {
  const noSleep = async (): Promise<void> => {}

  it('retries network errors and 502/503/504 up to the limit', async () => {
    const { fetch, calls } = recordingFetch([new TypeError('reset'), new Response(null, { status: 503 }), new Response('ok')])
    const sleeps: number[] = []
    const client = createHttpClient({ fetch, resolver, sleep: async (ms) => { sleeps.push(ms) } })
    const res = await client.requestIdempotent('https://api.vendor.example/status', { retries: 2 })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([200, 400])
  })

  it('returns the last retryable response once attempts run out', async () => {
    const { fetch, calls } = recordingFetch([new Response(null, { status: 502 }), new Response(null, { status: 504 })])
    const res = await createHttpClient({ fetch, resolver, sleep: noSleep }).requestIdempotent('https://api.vendor.example/', { retries: 1 })
    expect(res.status).toBe(504)
    expect(calls).toHaveLength(2)
  })

  it('throws the last network error once attempts run out', async () => {
    const { fetch } = recordingFetch([new TypeError('a'), new TypeError('b')])
    await expect(createHttpClient({ fetch, resolver, sleep: noSleep }).requestIdempotent('https://api.vendor.example/', { retries: 1 }))
      .rejects.toMatchObject({ code: 'network_error' })
  })

  it('does not retry by default, nor on other statuses, timeouts or blocked destinations', async () => {
    const once = recordingFetch([new TypeError('reset')])
    await expect(createHttpClient({ fetch: once.fetch, resolver, sleep: noSleep }).requestIdempotent('https://api.vendor.example/')).rejects.toThrow()
    expect(once.calls).toHaveLength(1)

    const notFound = recordingFetch([new Response(null, { status: 500 })])
    expect((await createHttpClient({ fetch: notFound.fetch, resolver, sleep: noSleep }).requestIdempotent('https://api.vendor.example/', { retries: 2 })).status).toBe(500)
    expect(notFound.calls).toHaveLength(1)

    await expect(createHttpClient({ fetch: hangingFetch(), resolver, sleep: noSleep }).requestIdempotent('https://api.vendor.example/', { retries: 2, timeoutMs: 10 }))
      .rejects.toMatchObject({ code: 'timeout' })

    const blocked = recordingFetch([])
    await expect(createHttpClient({ fetch: blocked.fetch, resolver, sleep: noSleep }).requestIdempotent('https://127.0.0.1/', { retries: 2 }))
      .rejects.toMatchObject({ code: 'invalid_url' })
    expect(blocked.calls).toHaveLength(0)
  })

  it('sends HEAD when asked', async () => {
    const { fetch, calls } = recordingFetch([new Response(null)])
    await createHttpClient({ fetch, resolver }).requestIdempotent('https://api.vendor.example/', { method: 'HEAD' })
    expect(calls[0]?.init?.method).toBe('HEAD')
  })

  it('refuses unsafe methods and out-of-range retries', async () => {
    const { fetch } = recordingFetch([])
    const client = createHttpClient({ fetch, resolver })
    await expect(client.requestIdempotent('https://api.vendor.example/', { method: 'POST' as 'GET' })).rejects.toBeInstanceOf(TypeError)
    await expect(client.requestIdempotent('https://api.vendor.example/', { retries: 3 })).rejects.toBeInstanceOf(RangeError)
    await expect(client.requestIdempotent('https://api.vendor.example/', { retries: 1.5 })).rejects.toBeInstanceOf(RangeError)
  })
})

describe('defaults', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the global fetch and a real backoff when none are injected', async () => {
    const responses = [new Response(null, { status: 503 }), new Response('ok')]
    const global = vi.fn(async () => responses.shift()!)
    vi.stubGlobal('fetch', global)
    const res = await createHttpClient({ resolver }).requestIdempotent('https://api.vendor.example/', { retries: 1 })
    expect(res.status).toBe(200)
    expect(global).toHaveBeenCalledTimes(2)
  })

  it('resolves through the global fetch when no resolver or fetch is injected', async () => {
    const global = vi.fn(async (url: string) => url.startsWith('https://cloudflare-dns.com/')
      ? Response.json({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34', TTL: 300 }] })
      : new Response('ok'))
    vi.stubGlobal('fetch', global)
    expect((await createHttpClient().requestOnce('https://hooks.example.com/')).status).toBe(200)
    expect(global).toHaveBeenCalledTimes(5)
  })
})
