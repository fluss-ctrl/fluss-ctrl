// Prefixed, sortable resource ids (SPEC §1): `<prefix>_<UUIDv7>`. The UUID is RFC 9562 version 7
// with a 12-bit sub-millisecond counter in `rand_a` (method 3), so ids generated in sequence by one
// isolate sort in creation order even inside one millisecond or across a small clock step back.

/** Prefixes from SPEC §1 for Phase 0–1 resources, plus `req` for request ids. */
export const ID_PREFIXES = ['org', 'site', 'ctl', 'dev', 'grp', 'sub', 'grt', 'cmd', 'evt', 'whk', 'cli', 'req'] as const

export type IdPrefix = typeof ID_PREFIXES[number]
export type Id<P extends IdPrefix = IdPrefix> = `${P}_${string}`

export interface IdGeneratorDeps {
  /** Milliseconds since the Unix epoch. Inject a clock in tests (CLAUDE.md "Testing"). */
  now?: () => number
  /** Fills the array with random bytes. Defaults to WebCrypto. */
  randomBytes?: (bytes: Uint8Array<ArrayBuffer>) => void
}

/** The UUIDv7 part of an id, lower-case hex. Shared with the OpenAPI id schemas (schemas/ids.ts). */
export const UUID_V7_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const UUID_V7 = new RegExp(`^${UUID_V7_PATTERN}$`)
const MAX_COUNTER = 0xfff
// A fresh millisecond seeds the counter in the lower half, leaving at least 2048 increments.
const SEED_MASK = 0x7ff

function hex (bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`
}

/** Returns a generator with its own monotonic state. `newId` uses a shared default instance. */
export function createIdGenerator (deps: IdGeneratorDeps = {}): <P extends IdPrefix>(prefix: P) => Id<P> {
  const now = deps.now ?? Date.now
  const randomBytes = deps.randomBytes ?? ((b: Uint8Array<ArrayBuffer>) => { crypto.getRandomValues(b) })
  let lastMs = -1
  let counter = 0

  return <P extends IdPrefix>(prefix: P): Id<P> => {
    if (!(ID_PREFIXES as readonly string[]).includes(prefix)) throw new TypeError(`Unknown id prefix: ${String(prefix)}`)
    const bytes = new Uint8Array(16)
    randomBytes(bytes)

    let ms = Math.max(Math.floor(now()), lastMs)
    if (ms === lastMs) {
      counter++
      if (counter > MAX_COUNTER) {
        ms = lastMs + 1
        counter = ((bytes[6]! << 8) | bytes[7]!) & SEED_MASK
      }
    } else {
      counter = ((bytes[6]! << 8) | bytes[7]!) & SEED_MASK
    }
    lastMs = ms

    // 48-bit big-endian timestamp. Split to stay inside safe integer bit operations.
    const high = Math.floor(ms / 2 ** 16)
    bytes[0] = (high >>> 24) & 0xff
    bytes[1] = (high >>> 16) & 0xff
    bytes[2] = (high >>> 8) & 0xff
    bytes[3] = high & 0xff
    bytes[4] = (ms >>> 8) & 0xff
    bytes[5] = ms & 0xff
    bytes[6] = 0x70 | (counter >>> 8)
    bytes[7] = counter & 0xff
    bytes[8] = 0x80 | (bytes[8]! & 0x3f)

    return `${prefix}_${hex(bytes)}`
  }
}

/** `newId('dev')` → `dev_0193…`, a UUIDv7 under the prefix. */
export const newId: <P extends IdPrefix>(prefix: P) => Id<P> = createIdGenerator()

/** True when `value` is a well-formed id, optionally with the given prefix. */
export function isId<P extends IdPrefix> (value: unknown, prefix?: P): value is Id<P> {
  if (typeof value !== 'string') return false
  const sep = value.indexOf('_')
  if (sep < 0) return false
  const p = value.slice(0, sep)
  if (prefix !== undefined ? p !== prefix : !(ID_PREFIXES as readonly string[]).includes(p)) return false
  return UUID_V7.test(value.slice(sep + 1))
}

/** Milliseconds since the epoch encoded in an id's UUIDv7. */
export function idTimestamp (id: Id): number {
  const hexDigits = id.slice(id.indexOf('_') + 1).replaceAll('-', '').slice(0, 12)
  return Number.parseInt(hexDigits, 16)
}
