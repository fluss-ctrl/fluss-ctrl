// Stable error codes and RFC 9457 problem details (SPEC §1, §7.3). `code` is the API contract;
// `title` and `detail` are not. Every code here has a page in apps/docs/src/content/docs/errors/,
// and a test fails if one is missing. Codes are only ever added, never renamed or removed.
//
// Phase 0–1 only (SPEC §0). Codes for later phases (the emergency codes, `controller_owned`) are
// added with the work that produces them.

export const ERROR_DOCS_BASE = 'https://docs.flussctrl.com/errors/'

interface ErrorDefinition {
  readonly status: number
  readonly title: string
}

export const ERROR_CODES = {
  // Generic request failures (SPEC §7.3 "Before a command exists", §1 rate limits, §21.5).
  unauthorised: { status: 401, title: 'Unauthorised' },
  insufficient_scope: { status: 403, title: 'Insufficient scope' },
  not_found: { status: 404, title: 'Not found' },
  validation_failed: { status: 422, title: 'Validation failed' },
  rate_limited: { status: 429, title: 'Rate limited' },
  internal_error: { status: 500, title: 'Internal error' },
  service_unavailable: { status: 503, title: 'Service unavailable' },

  // Idempotency (SPEC §1).
  idempotency_key_reused: { status: 422, title: 'Idempotency key reused' },
  idempotency_in_progress: { status: 409, title: 'Idempotency key in progress' },

  // Devices and grants (SPEC §4, §5, §6).
  controller_already_claimed: { status: 409, title: 'Controller already claimed' },
  grant_type_unsupported: { status: 422, title: 'Grant type unsupported' },
  delegation_not_allowed: { status: 422, title: 'Delegation not allowed' },

  // Command rejections at accept time (SPEC §7.3).
  grant_invalid: { status: 403, title: 'Grant invalid' },
  grant_exhausted: { status: 403, title: 'Grant exhausted' },
  device_offline: { status: 409, title: 'Device offline' },
  command_rate_limited: { status: 409, title: 'Command rate limited' },
  action_unsupported: { status: 422, title: 'Action unsupported' },
  provider_disabled: { status: 409, title: 'Provider disabled' },
  provider_unavailable: { status: 503, title: 'Provider unavailable' },
} as const satisfies Record<string, ErrorDefinition>

export type ErrorCode = keyof typeof ERROR_CODES

export function isErrorCode (value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CODES, value)
}

/** RFC 9457 problem details as the API renders them (SPEC §1). */
export interface ProblemDetails {
  type: string
  title: string
  status: number
  code: ErrorCode
  detail?: string
  request_id: string
  /** Extension members, such as `command_id` on a recorded rejection (SPEC §7.3). */
  [extension: string]: unknown
}

const RESERVED = new Set(['type', 'title', 'status', 'code', 'detail', 'request_id'])

export interface ProblemOptions {
  detail?: string
  /** Extra members, such as `{ command_id }`. They cannot overwrite the standard members. */
  extensions?: Record<string, unknown>
}

/** Renders the problem body for a code. The HTTP status is the code's own; there is no override. */
export function problemDetails (code: ErrorCode, requestId: string, options: ProblemOptions = {}): ProblemDetails {
  const def = ERROR_CODES[code]
  const body: ProblemDetails = {
    type: `${ERROR_DOCS_BASE}${code}`,
    title: def.title,
    status: def.status,
    code,
    request_id: requestId,
  }
  if (options.detail !== undefined) body.detail = options.detail
  for (const [key, value] of Object.entries(options.extensions ?? {})) {
    if (!RESERVED.has(key)) body[key] = value
  }
  return body
}

/**
 * Thrown by handlers to fail a request with a stable code. The API's error handler renders it as
 * problem details. `detail` goes to the client, so it must never hold secrets or phone numbers.
 */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly detail: string | undefined
  readonly extensions: Record<string, unknown> | undefined

  constructor (code: ErrorCode, options: ProblemOptions = {}) {
    super(options.detail ?? ERROR_CODES[code].title)
    this.name = 'ApiError'
    this.code = code
    this.status = ERROR_CODES[code].status
    this.detail = options.detail
    this.extensions = options.extensions
  }

  toProblem (requestId: string): ProblemDetails {
    const options: ProblemOptions = {}
    if (this.detail !== undefined) options.detail = this.detail
    if (this.extensions !== undefined) options.extensions = this.extensions
    return problemDetails(this.code, requestId, options)
  }
}
