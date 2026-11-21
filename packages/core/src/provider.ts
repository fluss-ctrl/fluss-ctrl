// The Provider contract (SPEC §10, §10.1): what every device adapter implements. Phase 0–1 members
// only. Onboarding (claim/link/discover), push ingest, polling, grant sync and native holds arrive
// with the phases that build them (SPEC §0); add them here then, not before.
import type { ZodType } from 'zod'

/** Providers known to the platform. Add a code when its package is built from a spec mapping. */
export type ProviderCode = 'simulator' | 'fluss_plus' | 'gemini' | 'nice'

export type OnboardingMode = 'claim_code' | 'account_link' | 'connector'

/** `unofficial` = reverse-engineered, no vendor contract (SPEC §22). */
export type ProviderStability = 'official' | 'partner' | 'unofficial'

/** v1 actions (SPEC §7). `lock`/`unlock` are reserved for the connector providers. */
export type CommandAction = 'trigger' | 'open' | 'close'
export const COMMAND_ACTIONS: readonly CommandAction[] = ['trigger', 'open', 'close']

/** SPEC §7.1: three levels only. */
export type VerificationLevel = 'none' | 'ack' | 'status'

/** Grant types a device can honour (SPEC §6; `tenant_access` is modelled, not exposed). */
export type GrantType = 'full_access' | 'permanent' | 'time_window' | 'recurring' | 'count_limited'

/**
 * What a device's status input reports. `closed` means fully closed (a gate reports it only at the
 * end of its travel); `open` means anything else; `unknown` means the device gave no reading.
 */
export type DeviceState = 'open' | 'closed' | 'unknown'

/** A device as a provider sees it: enough to address it, never a database row. */
export interface DeviceRef {
  /** Our id for the device (`dev_…`). */
  readonly device_id: string
  /** The vendor's id for the unit (`controllers.provider_ref`). */
  readonly provider_ref: string
  /** The output on the unit, e.g. `io:1`. */
  readonly channel: string
  /** Per-device provider configuration, validated by the descriptor's `config_schema`. */
  readonly config: Readonly<Record<string, unknown>>
  /** Decrypted credentials for this call only (SPEC §10: providers are stateless). */
  readonly credentials?: Readonly<Record<string, unknown>>
}

export interface CommandRequest {
  /** Our command id (`cmd_…`), for correlating vendor logs. */
  readonly command_id: string
  readonly action: CommandAction
  /** The command's `params` from the API request, passed through. */
  readonly params?: Readonly<Record<string, unknown>>
}

/** `getStatus` result (SPEC §10). */
export interface DeviceStatus {
  readonly state: DeviceState
  /** RFC 3339 UTC: when the provider observed it. */
  readonly observed_at: string
  readonly online: boolean
}

/** Stable provider error codes (SPEC §10). */
export type ProviderErrorCode = 'offline' | 'timeout' | 'unauthorised' | 'unsupported' | 'rate_limited' | 'vendor_error'
export const PROVIDER_ERROR_CODES: readonly ProviderErrorCode[] = ['offline', 'timeout', 'unauthorised', 'unsupported', 'rate_limited', 'vendor_error']

export interface ProviderErrorOptions {
  /** True when the request may have reached the vendor, so the effect may still happen (SPEC §7.2). */
  readonly ambiguous?: boolean
  /** Raw vendor payload, for ops only. Never shown to API clients. */
  readonly detail?: unknown
}

/**
 * The only error a provider surfaces. Vendor errors are mapped to a stable `code`; the vendor's
 * payload goes in `detail` (SPEC §10).
 */
export class ProviderError extends Error {
  override readonly name = 'ProviderError'
  readonly code: ProviderErrorCode
  readonly ambiguous: boolean
  readonly detail: unknown

  constructor (code: ProviderErrorCode, message: string, options: ProviderErrorOptions = {}) {
    super(message)
    this.code = code
    this.ambiguous = options.ambiguous ?? false
    this.detail = options.detail
  }
}

export function isProviderError (value: unknown): value is ProviderError {
  return value instanceof ProviderError
}

/**
 * `sendCommand` result (SPEC §10). A send that failed resolves with `acked: false` and `error`
 * rather than throwing, so the coordinator has one shape to read. `error.ambiguous` says whether
 * the command may still have reached the device: if so, verify; never resend (SPEC §7.2).
 */
export interface SendResult {
  readonly acked: boolean
  /** The vendor's reference for the command, for matching log echoes (SPEC §8.1). */
  readonly provider_ref?: string
  readonly error?: ProviderError
}

export interface ProviderHealth {
  readonly ok: boolean
  /** RFC 3339 UTC. */
  readonly checked_at: string
  readonly detail?: string
}

/** Default capabilities for the provider's devices (SPEC §10.1, less the Phase 4 `hold`). */
export interface ProviderCapabilities {
  readonly actions: readonly CommandAction[]
  readonly status: boolean
  readonly ack: boolean
  readonly verification_level: VerificationLevel
  readonly min_command_interval_s: number
  readonly supports_grant_types: readonly GrantType[]
  readonly supports_remote_grant_sync: boolean
  readonly push: boolean
  readonly poll_status_interval_s: number
}

export type ConfirmWindows = Readonly<Record<CommandAction, number>>

export interface ProviderDescriptor {
  readonly code: ProviderCode
  readonly name: string
  readonly onboarding: OnboardingMode
  readonly stability: ProviderStability
  readonly capabilities: ProviderCapabilities
  readonly timeouts: { readonly send_s: number, readonly confirm_window_s: ConfirmWindows }
  /** Validates `DeviceRef.config`. */
  readonly config_schema: ZodType
  readonly docs_url: string
}

/** SPEC §7.1, §7.2 defaults. */
export const DEFAULT_TIMEOUTS = { send_s: 8, confirm_window_s: { trigger: 10, open: 10, close: 45 } } as const satisfies ProviderDescriptor['timeouts']

export interface Provider {
  readonly code: ProviderCode
  readonly onboarding: OnboardingMode
  readonly stability: ProviderStability
  describe(): ProviderDescriptor
  unlinkDevice(device: DeviceRef): Promise<void>
  /**
   * A fresh reading. An unreachable device resolves with `online: false`; other failures throw a
   * `ProviderError`.
   */
  getStatus(device: DeviceRef): Promise<DeviceStatus>
  /**
   * Sends one command, once. Only the device's `DeviceCoordinator` calls this, and nothing ever
   * retries it (SPEC §7.2). Resolves with `error` on failure instead of throwing.
   */
  sendCommand(device: DeviceRef, cmd: CommandRequest): Promise<SendResult>
  health(): Promise<ProviderHealth>
}
