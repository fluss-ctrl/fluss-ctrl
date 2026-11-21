import type { CommandAction, ProviderCapabilities } from '@flussctrl/core'
import { z } from 'zod'
import type { GateParams } from './gate.ts'

/** A simulated device's `behaviour` (SPEC §10.2). Every field has the spec's default. */
export const behaviourSchema = z.object({
  online: z.boolean().default(true),
  verification_level: z.enum(['none', 'ack', 'status']).default('status'),
  latency_ms: z.number().int().min(0).max(60_000).default(300),
  fail_rate: z.number().min(0).max(1).default(0),
  status_model: z.enum(['gate_slow', 'door_lock', 'none']).default('gate_slow'),
  pulse_mode: z.enum(['toggle', 'open_only']).default('toggle'),
  autoclose_s: z.number().min(0).max(3600).nullable().default(15),
  travel_s: z.number().min(0).max(600).default(12),
  /** Where the simulated gate starts the first time it is touched. */
  initial_state: z.enum(['closed', 'open']).default('closed'),
}).refine((b) => b.verification_level !== 'status' || b.status_model !== 'none', {
  message: 'verification_level "status" needs a status_model other than "none"',
  path: ['verification_level'],
})

export type Behaviour = z.infer<typeof behaviourSchema>

/** `DeviceRef.config` for the simulator: `{ behaviour }`. */
export const simulatorConfigSchema = z.object({
  behaviour: behaviourSchema.prefault({}),
})

export type SimulatorConfig = z.infer<typeof simulatorConfigSchema>

export const SIMULATE_OUTCOMES = ['timeout', 'offline', 'reject', 'no_status', 'ambiguous'] as const
export type SimulateOutcome = typeof SIMULATE_OUTCOMES[number]
export const simulateSchema = z.enum(SIMULATE_OUTCOMES).optional()

export function gateParams (b: Behaviour): GateParams {
  return {
    pulse_mode: b.pulse_mode,
    // A door lock releases and relocks at once (1 ms); its autoclose is the release time.
    travel_ms: b.status_model === 'door_lock' ? 1 : Math.max(1, Math.round(b.travel_s * 1000)),
    autoclose_ms: b.autoclose_s === null ? null : Math.round(b.autoclose_s * 1000),
  }
}

/**
 * The device's capabilities given its behaviour (SPEC §7, §10.1). `close` needs status and a motor
 * a pulse can close, so it is offered only for `toggle` devices that report status.
 */
export function capabilitiesFor (b: Behaviour): ProviderCapabilities {
  const status = b.status_model !== 'none'
  const actions: CommandAction[] = status && b.pulse_mode === 'toggle' ? ['trigger', 'open', 'close'] : ['trigger', 'open']
  return {
    actions,
    status,
    ack: b.verification_level !== 'none',
    verification_level: b.verification_level,
    min_command_interval_s: 2,
    supports_grant_types: ['full_access', 'permanent', 'time_window', 'recurring', 'count_limited'],
    supports_remote_grant_sync: false,
    push: false,
    poll_status_interval_s: 1,
  }
}
