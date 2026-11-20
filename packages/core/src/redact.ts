// Redaction for log lines and error details (SPEC §1, §14; CLAUDE.md "Data and tenancy"). Every
// structured log object goes through `redact` before it is written. It over-redacts on purpose:
// a lost digit string in a log costs nothing, a leaked phone number or token does.

export const REDACTED = '[REDACTED]'

// Keys whose whole value is sensitive, whatever it looks like.
const SENSITIVE_KEY = /pass(word|phrase)?|secret|token|authori[sz]ation|api[-_]?key|cookie|credential|signature|private[-_]?key|phone|msisdn|mobile|claim[-_]?code|otp/i

// `Bearer abc`, `Basic abc`: the scheme survives so a log still says what kind of credential it was.
const AUTH_SCHEME = /\b(bearer|basic)\s+[\w.~+/=-]+/gi
// JWTs and Standard Webhooks secrets, wherever they appear.
const JWT = /\beyJ[\w-]*\.[\w-]+\.[\w-]*/g
const WEBHOOK_SECRET = /\bwhsec_[A-Za-z0-9+/=]+/g
// Phone numbers: an optional `+`, then nine or more digits, with up to two spaces, dots, dashes or
// parentheses between digits (`+27 (82) 555-1234`). Any run that long is treated as a phone number;
// UUIDs, and so our ids, are set aside first so their digit groups survive.
const PHONE = /\+?\(?\d(?:[ .()-]{0,2}\d){8,}\)?/g
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Redacts credentials and phone numbers inside a string. */
export function redactString (value: string): string {
  const scrubbed = value
    .replace(AUTH_SCHEME, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(WEBHOOK_SECRET, REDACTED)
  // Redact phone numbers only in the text between UUIDs.
  let out = ''
  let last = 0
  for (const match of scrubbed.matchAll(UUID)) {
    out += scrubbed.slice(last, match.index).replace(PHONE, REDACTED) + match[0]
    last = match.index + match[0].length
  }
  return out + scrubbed.slice(last).replace(PHONE, REDACTED)
}

/**
 * Returns a redacted deep copy of a log object. Values under sensitive keys are replaced whole;
 * every other string is scanned. Never mutates its input. Cycles become `[Circular]`.
 */
export function redact (value: unknown): unknown {
  return walk(value, new WeakSet())
}

function walk (value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value)
  if (typeof value !== 'object' || value === null) return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  let out: unknown
  if (Array.isArray(value)) {
    out = value.map((item) => walk(item, seen))
  } else if (value instanceof Error) {
    out = { name: value.name, message: redactString(value.message) }
  } else {
    const obj: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      obj[key] = SENSITIVE_KEY.test(key) && item !== null && item !== undefined ? REDACTED : walk(item, seen)
    }
    out = obj
  }
  seen.delete(value)
  return out
}
