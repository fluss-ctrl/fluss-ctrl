// SSRF guard (SPEC §8.2, PLAN §8; CLAUDE.md "Any URL the system will call that a user supplied").
// A destination is allowed only if it is https, carries no user info, and the host is, or resolves
// only to, public addresses. Run at creation (to reject a webhook URL early) and again before every
// request, because DNS can change in between.

import { OutboundHttpError } from './errors.ts'
import { isPublicIp, parseIp } from './ip.ts'
import type { Resolver } from './resolver.ts'

// Names that are local by definition; refused without asking DNS.
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
  return url
}

/**
 * Throws OutboundHttpError unless every address behind the URL is public. Returns the parsed URL.
 * WHATWG URL parsing has already normalised odd IPv4 spellings (`0x7f.1`, `2130706433`) to dotted
 * quads by the time the host is checked.
 */
export async function assertPublicDestination (input: string | URL, resolver: Resolver, signal: AbortSignal): Promise<URL> {
  const url = parseDestination(input)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')

  if (parseIp(host)) {
    if (!isPublicIp(host)) throw new OutboundHttpError('destination_blocked', host)
    return url
  }
  if (!host.includes('.') || host === 'localhost' || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new OutboundHttpError('destination_blocked', host)
  }

  const addresses = await resolver.resolve(host, signal)
  if (addresses.length === 0) throw new OutboundHttpError('destination_unresolvable', host)
  if (!addresses.every(isPublicIp)) throw new OutboundHttpError('destination_blocked', host)
  return url
}
