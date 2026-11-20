// DNS resolution for the SSRF guard. Workers' fetch() resolves names itself and exposes no hook, so
// the guard resolves first, over DNS-over-HTTPS, and checks every address (ADR-0002).

import { OutboundHttpError } from './errors.ts'

export interface ResolvedAddress {
  address: string
  /** Seconds the answer may be cached for. */
  ttl: number
}

export interface Resolver {
  /** Every A and AAAA record for the name; an empty array when it has none. */
  resolve (hostname: string, signal: AbortSignal): Promise<ResolvedAddress[]>
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface DohResolverOptions {
  /** A JSON DoH endpoint (RFC 8484 JSON form). Defaults to Cloudflare's 1.1.1.1 service. */
  endpoint?: string
  fetch?: FetchLike
}

const NOERROR = 0
const NXDOMAIN = 3
const TYPE_A = 1
const TYPE_AAAA = 28

interface DohAnswer { type: number, data: string, TTL: number }

function answers (body: unknown): { status: number, records: DohAnswer[] } | null {
  if (typeof body !== 'object' || body === null) return null
  const { Status, Answer } = body as { Status?: unknown, Answer?: unknown }
  if (typeof Status !== 'number') return null
  if (Answer === undefined) return { status: Status, records: [] }
  if (!Array.isArray(Answer)) return null
  const records: DohAnswer[] = []
  for (const a of Answer as unknown[]) {
    if (typeof a !== 'object' || a === null) return null
    const { type, data, TTL } = a as { type?: unknown, data?: unknown, TTL?: unknown }
    if (typeof type !== 'number' || typeof data !== 'string' || typeof TTL !== 'number') return null
    records.push({ type, data, TTL })
  }
  return { status: Status, records }
}

export function createDohResolver (options: DohResolverOptions = {}): Resolver {
  const endpoint = options.endpoint ?? 'https://cloudflare-dns.com/dns-query'
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))

  async function query (hostname: string, type: 'A' | 'AAAA', signal: AbortSignal): Promise<ResolvedAddress[]> {
    const url = `${endpoint}?name=${encodeURIComponent(hostname)}&type=${type}`
    let res: Response
    try {
      res = await doFetch(url, { headers: { accept: 'application/dns-json' }, signal })
    } catch (err) {
      if (signal.aborted) throw err
      throw new OutboundHttpError('dns_failed', hostname, { cause: err })
    }
    if (!res.ok) throw new OutboundHttpError('dns_failed', hostname)
    const parsed = answers(await res.json().catch(() => null))
    if (!parsed) throw new OutboundHttpError('dns_failed', hostname)
    if (parsed.status === NXDOMAIN) return []
    if (parsed.status !== NOERROR) throw new OutboundHttpError('dns_failed', hostname)
    // CNAME records are followed by the resolver and listed alongside; return only addresses, but
    // each carries the shortest TTL in the answer: an alias that may change soon makes every
    // address behind it just as short-lived.
    const want = type === 'A' ? TYPE_A : TYPE_AAAA
    const minTtl = Math.min(...parsed.records.map((r) => r.TTL))
    return parsed.records.filter((r) => r.type === want).map((r) => ({ address: r.data, ttl: Math.min(r.TTL, minTtl) }))
  }

  return {
    async resolve (hostname, signal) {
      const [a, aaaa] = await Promise.all([query(hostname, 'A', signal), query(hostname, 'AAAA', signal)])
      return [...a, ...aaaa]
    },
  }
}
