// SSRF guard (SPEC §8.2, PLAN §8; CLAUDE.md "Any URL the system will call that a user supplied").
// A destination is allowed only if it is https on port 443, carries no user info, names a host
// (never an IP literal), and that host resolves only to public addresses whose DNS answers live at
// least MIN_DNS_TTL_S. Run at creation (to reject a webhook URL early) and again before every
// request, because DNS can change in between. ADR-0002 explains the limits of a check on Workers.

import { OutboundHttpError } from './errors.ts'
import { isPublicIp, parseIp } from './ip.ts'
import type { Resolver } from './resolver.ts'

// Names that are local by definition; refused without asking DNS.
/**
 * Answers that may change sooner than this are refused: Workers' fetch() resolves the name again,
 * and a short TTL is what a DNS-rebinding attack needs to answer differently the second time.
 */
export const MIN_DNS_TTL_S = 30

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet']

function parseDestination (input: string | URL): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new OutboundHttpError('invalid_url')
  }
  if (url.protocol !== 'https:') throw new OutboundHttpError('invalid_url', url.hostname)
  if (url.username !== '' || url.password !== '') throw new OutboundHttpError('invalid_url', url.hostname)
  // WHATWG URL drops a default port, so any explicit port here is not 443.
  if (url.port !== '') throw new OutboundHttpError('invalid_url', url.hostname)
  // IP literals are refused outright, public or not: destinations are named hosts. WHATWG URL has
  // already normalised odd IPv4 spellings (`0x7f.1`, `2130706433`) to dotted quads.
  if (parseIp(url.hostname)) throw new OutboundHttpError('invalid_url', url.hostname)
  return url
}

/** Throws OutboundHttpError unless the destination passes the guard. Returns the parsed URL. */
export async function assertPublicDestination (input: string | URL, resolver: Resolver, signal: AbortSignal): Promise<URL> {
  const url = parseDestination(input)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')

  if (!host.includes('.') || host === 'localhost' || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new OutboundHttpError('destination_blocked', host)
  }

  const records = await resolver.resolve(host, signal)
  if (records.length === 0) throw new OutboundHttpError('destination_unresolvable', host)
  if (!records.every((r) => isPublicIp(r.address))) throw new OutboundHttpError('destination_blocked', host)
  if (records.some((r) => r.ttl < MIN_DNS_TTL_S)) throw new OutboundHttpError('destination_unstable', host)
  return url
}

/**
 * After a response, resolves the name again and throws `destination_changed` if any address is no
 * longer public. The request has already been sent, so this cannot prevent a rebinding attack; it
 * turns one into a failure the caller sees and logs instead of a silent success.
 * A failed lookup here is ignored (see below).
 */
export async function assertStillPublic (url: URL, resolver: Resolver, signal: AbortSignal): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  let records
  try {
    records = await resolver.resolve(host, signal)
  } catch {
    // A failed second lookup proves nothing either way, and failing here would turn a request that
    // was sent into an ambiguous one. The pre-request check already failed closed.
    return
  }
  if (!records.every((r) => isPublicIp(r.address))) throw new OutboundHttpError('destination_changed', host)
}
