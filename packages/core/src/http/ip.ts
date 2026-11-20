// IP address parsing and the public-address check behind the SSRF guard (SPEC §8.2, PLAN §8).
// Allow-list for IPv6 (global unicast only) and deny-list for IPv4, both from the IANA special
// purpose registries. Anything that does not parse is not public.

export type IpVersion = 4 | 6

/** Parses dotted-quad IPv4 (strict: four decimal octets, no leading zeros). */
export function parseIpv4 (text: string): number[] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const out: number[] = []
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    out.push(n)
  }
  return out
}

/** Parses IPv6 text (with `::`, an embedded IPv4 tail, no zone id) into eight 16-bit groups. */
export function parseIpv6 (text: string): number[] | null {
  if (text.includes('%')) return null
  let head = text
  let v4Tail: number[] = []
  const lastColon = text.lastIndexOf(':')
  if (lastColon >= 0 && text.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4(text.slice(lastColon + 1))
    if (!v4) return null
    v4Tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!]
    // Drop the ':' before the IPv4 tail, unless it is half of a '::'.
    head = text.slice(0, lastColon + 1)
    if (!head.endsWith('::')) head = head.slice(0, -1)
  }
  const want = 8 - v4Tail.length
  const halves = head.split('::')
  if (halves.length > 2) return null
  const parse = (s: string): number[] | null => {
    if (s === '') return []
    const groups: number[] = []
    for (const g of s.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
      groups.push(Number.parseInt(g, 16))
    }
    return groups
  }
  const left = parse(halves[0]!)
  if (!left) return null
  if (halves.length === 1) {
    return left.length === want ? [...left, ...v4Tail] : null
  }
  const right = parse(halves[1]!)
  if (!right) return null
  const fill = want - left.length - right.length
  if (fill < 1) return null
  return [...left, ...new Array<number>(fill).fill(0), ...right, ...v4Tail]
}

function inV4 (ip: number[], base: [number, number, number, number], bits: number): boolean {
  const toInt = (a: number[]): number => ((a[0]! << 24) >>> 0) + (a[1]! << 16) + (a[2]! << 8) + a[3]!
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return ((toInt(ip) & mask) >>> 0) === ((toInt(base) & mask) >>> 0)
}

// IANA IPv4 special-purpose registry, plus multicast and reserved space. 100.64/10 covers the
// Alibaba metadata address; 169.254/16 covers AWS, GCP and Azure metadata.
const V4_BLOCKED: Array<[[number, number, number, number], number]> = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, cloud metadata
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // 6to4 relay anycast (deprecated)
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation
  [[203, 0, 113, 0], 24], // documentation
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, and 255.255.255.255
]

export function isPublicIpv4 (ip: number[]): boolean {
  return !V4_BLOCKED.some(([base, bits]) => inV4(ip, base, bits))
}

export function isPublicIpv6 (g: number[]): boolean {
  // IPv4-mapped ::ffff:a.b.c.d and NAT64 64:ff9b::a.b.c.d: judge the embedded IPv4 address.
  const embedded = [g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff]
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicIpv4(embedded)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicIpv4(embedded)
  // Only global unicast (2000::/3) is public; that excludes ::, ::1, fc00::/7 (unique local, incl.
  // the AWS fd00:ec2::254 metadata address), fe80::/10, fec0::/10 and ff00::/8.
  if ((g[0]! & 0xe000) !== 0x2000) return false
  if (g[0] === 0x2001 && g[1]! < 0x0200) return false // 2001::/23 IETF assignments, incl. Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false // documentation
  if (g[0] === 0x2002) return false // 6to4: embeds an arbitrary IPv4 address
  if (g[0] === 0x3fff && g[1]! < 0x1000) return false // documentation (RFC 9637)
  return true
}

/** Parses an IP literal (IPv6 may be bracketed, as in a URL host). Null if it is not one. */
export function parseIp (text: string): { version: IpVersion, parts: number[] } | null {
  const v4 = parseIpv4(text)
  if (v4) return { version: 4, parts: v4 }
  const bare = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text
  const v6 = parseIpv6(bare)
  return v6 ? { version: 6, parts: v6 } : null
}

/** True only for a parseable, publicly routable address. */
export function isPublicIp (text: string): boolean {
  const ip = parseIp(text)
  if (!ip) return false
  return ip.version === 4 ? isPublicIpv4(ip.parts) : isPublicIpv6(ip.parts)
}
