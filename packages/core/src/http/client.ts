// The one outbound HTTP client (SPEC §10 rules; CLAUDE.md "Providers"). Every request:
//   - passes the SSRF guard first, so a refused destination is never contacted;
//   - runs under a deadline covering DNS, connection and the response (default 8 s, SPEC §7.2);
//   - never follows redirects (SPEC §8.2); a 3xx comes back to the caller as a response.
//
// Two entry points, so that "never retry a sendCommand" (SPEC §7.2) is enforced by types:
//   - requestOnce: any method, sent at most once. It has no retry option at all. Provider command
//     sends, webhook deliveries (retried by the queue, not here) and every other non-idempotent
//     call use it.
//   - requestIdempotent: GET or HEAD only, may retry network errors and 502/503/504.

import { OutboundHttpError } from './errors.ts'
import { assertPublicDestination } from './guard.ts'
import { createDohResolver, type FetchLike, type Resolver } from './resolver.ts'

export const DEFAULT_TIMEOUT_MS = 8_000
export const MAX_IDEMPOTENT_RETRIES = 2
const RETRY_STATUSES = new Set([502, 503, 504])
const RETRY_BASE_DELAY_MS = 200

export interface HttpClientOptions {
  fetch?: FetchLike
  /** Defaults to DNS-over-HTTPS through `fetch` (ADR-0002). */
  resolver?: Resolver
  defaultTimeoutMs?: number
  /** Waits between idempotent retries. Injected in tests. */
  sleep?: (ms: number) => Promise<void>
}

interface BaseRequestOptions {
  headers?: HeadersInit
  /** Deadline for this attempt, from DNS lookup to response headers and body. */
  timeoutMs?: number
  /** The caller's own cancellation. */
  signal?: AbortSignal
}

export interface RequestOnceOptions extends BaseRequestOptions {
  method?: string
  body?: BodyInit | null
}

export interface IdempotentRequestOptions extends BaseRequestOptions {
  method?: 'GET' | 'HEAD'
  /** Extra attempts after the first, for network errors and 502/503/504 only. 0 to 2; default 0. */
  retries?: number
}

export interface HttpClient {
  requestOnce (url: string | URL, options?: RequestOnceOptions): Promise<Response>
  requestIdempotent (url: string | URL, options?: IdempotentRequestOptions): Promise<Response>
}

export function createHttpClient (options: HttpClientOptions = {}): HttpClient {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const resolver = options.resolver ?? createDohResolver({ fetch: doFetch })
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  async function attempt (url: string | URL, init: RequestInit, base: BaseRequestOptions): Promise<Response> {
    const timeoutMs = base.timeoutMs ?? defaultTimeoutMs
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be a positive number')

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    const onCallerAbort = (): void => { controller.abort() }
    if (base.signal?.aborted) controller.abort()
    base.signal?.addEventListener('abort', onCallerAbort, { once: true })

    let host: string | undefined
    try {
      const target = await assertPublicDestination(url, resolver, controller.signal)
      host = target.hostname
      // A deadline or caller abort during DNS stops here, before anything reaches the destination.
      controller.signal.throwIfAborted()
      return await doFetch(target.toString(), { ...init, headers: base.headers, redirect: 'manual', signal: controller.signal })
    } catch (err) {
      clearTimeout(timer)
      if (timedOut) throw new OutboundHttpError('timeout', host, { cause: err })
      if (base.signal?.aborted) throw new OutboundHttpError('aborted', host, { cause: err })
      if (err instanceof OutboundHttpError) throw err
      throw new OutboundHttpError('network_error', host, { cause: err })
    } finally {
      // On success the timer stays armed: the deadline also covers reading the response body.
      base.signal?.removeEventListener('abort', onCallerAbort)
    }
  }

  return {
    requestOnce (url, opts = {}) {
      return attempt(url, { method: opts.method ?? 'GET', body: opts.body ?? null }, opts)
    },

    async requestIdempotent (url, opts = {}) {
      const method = opts.method ?? 'GET'
      if (method !== 'GET' && method !== 'HEAD') throw new TypeError('requestIdempotent accepts GET or HEAD only')
      const retries = opts.retries ?? 0
      if (!Number.isInteger(retries) || retries < 0 || retries > MAX_IDEMPOTENT_RETRIES) {
        throw new RangeError(`retries must be an integer from 0 to ${MAX_IDEMPOTENT_RETRIES}`)
      }
      for (let n = 0; ; n++) {
        const last = n === retries
        try {
          const res = await attempt(url, { method }, opts)
          if (last || !RETRY_STATUSES.has(res.status)) return res
          await res.body?.cancel()
        } catch (err) {
          if (last || !(err instanceof OutboundHttpError) || err.code !== 'network_error') throw err
        }
        await sleep(RETRY_BASE_DELAY_MS * 2 ** n)
      }
    },
  }
}
