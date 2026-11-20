// Errors raised by packages/core/http. These are internal, not API error codes: a caller maps them
// (a webhook URL refused at creation becomes `validation_failed`; a provider send that times out
// becomes `ProviderError{ code: "timeout" }`). Messages carry the host only, never the full URL,
// because a query string can hold a credential.

export type OutboundErrorCode =
  | 'invalid_url' // not a URL, not https, not port 443, an IP literal, or carries user info
  | 'destination_blocked' // resolves to a private, loopback, link-local or metadata address, or is a local name
  | 'destination_unstable' // a DNS answer's TTL is below the minimum, so it could change before fetch connects
  | 'destination_changed' // after the response, the name resolved to a non-public address (possible rebinding)
  | 'destination_unresolvable' // no A or AAAA records
  | 'dns_failed' // the resolver itself failed
  | 'timeout' // the request's deadline passed before a response arrived
  | 'aborted' // the caller's signal fired
  | 'network_error' // fetch rejected for another reason

export class OutboundHttpError extends Error {
  readonly code: OutboundErrorCode
  readonly host: string | undefined

  constructor (code: OutboundErrorCode, host?: string, options?: { cause?: unknown }) {
    super(host ? `${code}: ${host}` : code, options)
    this.name = 'OutboundHttpError'
    this.code = code
    this.host = host
  }
}
