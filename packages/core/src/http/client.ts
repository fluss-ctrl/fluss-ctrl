// The one outbound HTTP client (SPEC §10 rules; CLAUDE.md "Providers"). Every request:
//   - passes the SSRF guard first, so a refused destination is never contacted, and is checked
//     again after the response, so a name that rebinds to a private address fails loudly;
//   - runs under a deadline covering DNS, connection and the response (default 8 s, SPEC §7.2);
//   - never follows redirects (SPEC §8.2); a 3xx comes back to the caller as a response.
//
// Two entry points, so that "never retry a sendCommand" (SPEC §7.2) is enforced by types:
//   - requestOnce: any method, sent at most once. It has no retry option at all. Provider command
//     sends, webhook deliveries (retried by the queue, not here) and every other non-idempotent
//     call use it.
//   - requestIdempotent: GET or HEAD only, may retry network errors and 502/503/504.

import { OutboundHttpError } from './errors.ts'
import { assertPublicDestination, assertStillPublic } from './guard.ts'
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
    // Owned by the controller's own signal: once the controller aborts (deadline, failure or the
    // caller), the listener is removed, so a long-lived caller signal does not collect listeners.
    base.signal?.addEventListener('abort', onCallerAbort, { once: true, signal: controller.signal })

    let host: string | undefined
    try {
      const target = await assertPublicDestination(url, resolver, controller.signal)
      host = target.hostname
      // A deadline or caller abort during DNS stops here, before anything reaches the destination.
      controller.signal.throwIfAborted()
      const res = await doFetch(target.toString(), { ...init, headers: base.headers, redirect: 'manual', signal: controller.signal })
      try {
        await assertStillPublic(target, resolver, controller.signal)
        // assertStillPublic ignores a failed lookup, including one the deadline or caller aborted;
        // either of those must still fail the request.
        controller.signal.throwIfAborted()
      } catch (err) {
        await res.body?.cancel().catch(() => {})
        throw err
      }
      // On success the timer and the caller's abort both stay wired to the controller, so they
      // also bound and cancel reading the response body.
      return res
    } catch (err) {
      base.signal?.removeEventListener('abort', onCallerAbort)
      // Cancel any DNS or fetch work still in flight (one of two parallel DoH queries, say).
      const wasAborted = controller.signal.aborted
      controller.abort()
      clearTimeout(timer)
      if (timedOut) throw new OutboundHttpError('timeout', host, { cause: err })
      if (wasAborted && base.signal?.aborted) throw new OutboundHttpError('aborted', host, { cause: err })
      if (err instanceof OutboundHttpError) throw err
      throw new OutboundHttpError('network_error', host, { cause: err })
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
