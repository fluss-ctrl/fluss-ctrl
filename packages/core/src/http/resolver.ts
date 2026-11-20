// DNS resolution for the SSRF guard. Workers' fetch() resolves names itself and exposes no hook, so
// the guard resolves first, over DNS-over-HTTPS, and checks every address (ADR-0002).

import { OutboundHttpError } from './errors.ts'

export interface Resolver {
  /** Every A and AAAA address for the name; an empty array when it has none. */
  resolve (hostname: string, signal: AbortSignal): Promise<string[]>
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

interface DohAnswer { type: number, data: string }

function answers (body: unknown): { status: number, records: DohAnswer[] } | null {
  if (typeof body !== 'object' || body === null) return null
  const { Status, Answer } = body as { Status?: unknown, Answer?: unknown }
  if (typeof Status !== 'number') return null
  if (Answer === undefined) return { status: Status, records: [] }
  if (!Array.isArray(Answer)) return null
  const records: DohAnswer[] = []
  for (const a of Answer as unknown[]) {
    if (typeof a !== 'object' || a === null) return null
    const { type, data } = a as { type?: unknown, data?: unknown }
    if (typeof type !== 'number' || typeof data !== 'string') return null
    records.push({ type, data })
  }
  return { status: Status, records }
}

export function createDohResolver (options: DohResolverOptions = {}): Resolver {
  const endpoint = options.endpoint ?? 'https://cloudflare-dns.com/dns-query'
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))

  async function query (hostname: string, type: 'A' | 'AAAA', signal: AbortSignal): Promise<string[]> {
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
    // CNAME records are followed by the resolver and listed alongside; keep only addresses.
    const want = type === 'A' ? TYPE_A : TYPE_AAAA
    return parsed.records.filter((r) => r.type === want).map((r) => r.data)
  }

  return {
    async resolve (hostname, signal) {
      const [a, aaaa] = await Promise.all([query(hostname, 'A', signal), query(hostname, 'AAAA', signal)])
      return [...a, ...aaaa]
    },
  }
}
