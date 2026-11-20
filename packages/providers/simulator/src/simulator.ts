// Simulator provider (SPEC §10.2): the reference Provider for sandbox organisations, tests and the
// conformance kit. It talks to no network. The simulated hardware lives in memory in each
// simulator instance, keyed by device id: that is the device, not provider state, and a new
// instance starts every device from its `initial_state`.
import {
  DEFAULT_TIMEOUTS,
  ProviderError,
  systemClock,
  type Clock,
  type CommandRequest,
  type DeviceRef,
  type DeviceStatus,
  type Provider,
  type ProviderCapabilities,
  type ProviderDescriptor,
  type ProviderHealth,
  type SendResult,
} from '@flussctrl/core'
import { behaviourSchema, capabilitiesFor, gateParams, simulateSchema, simulatorConfigSchema, type Behaviour } from './behaviour.ts'
import { advance, initialGate, pulse, reportedState, type GateState } from './gate.ts'

export interface SimulatorOptions {
  /** Defaults to the system clock. Tests pass a manual clock. */
  readonly clock?: Clock
  /** Returns a number in [0, 1) for `fail_rate`. Defaults to `Math.random`. */
  readonly random?: () => number
}

export interface SimulatorProvider extends Provider {
  /** Per-device capabilities for this device's behaviour (SPEC §10.1 device overrides). */
  capabilitiesFor(device: DeviceRef): ProviderCapabilities
}

interface SimulatedDevice {
  gate: GateState
  /** Set by `simulate: "no_status"`; cleared by the next command. */
  statusHidden: boolean
}

const DESCRIPTOR: ProviderDescriptor = {
  code: 'simulator',
  name: 'Simulator',
  onboarding: 'claim_code',
  stability: 'official',
  capabilities: capabilitiesFor(behaviourSchema.parse({})),
  timeouts: DEFAULT_TIMEOUTS,
  config_schema: simulatorConfigSchema,
  docs_url: 'https://docs.flussctrl.com/providers/simulator',
}

export function createSimulator (options: SimulatorOptions = {}): SimulatorProvider {
  const clock = options.clock ?? systemClock
  const random = options.random ?? Math.random
  const devices = new Map<string, SimulatedDevice>()

  function behaviourOf (device: DeviceRef): Behaviour {
    const parsed = simulatorConfigSchema.safeParse(device.config)
    if (!parsed.success) {
      throw new ProviderError('unsupported', 'Invalid simulator behaviour', { detail: parsed.error.issues })
    }
    return parsed.data.behaviour
  }

  function deviceAt (device: DeviceRef, b: Behaviour, now: number): SimulatedDevice {
    const params = gateParams(b)
    const existing = devices.get(device.device_id)
    const sim = existing ?? { gate: initialGate(params, now, b.initial_state), statusHidden: false }
    sim.gate = advance(sim.gate, params, now)
    devices.set(device.device_id, sim)
    return sim
  }

  const timestamp = (): string => new Date(clock.now()).toISOString()

  return {
    code: 'simulator',
    onboarding: 'claim_code',
    stability: 'official',

    describe: () => DESCRIPTOR,

    capabilitiesFor: (device) => capabilitiesFor(behaviourOf(device)),

    async unlinkDevice (device) {
      devices.delete(device.device_id)
    },

    async getStatus (device): Promise<DeviceStatus> {
      const b = behaviourOf(device)
      await clock.sleep(b.latency_ms)
      const observedAt = timestamp()
      if (!b.online) return { state: 'unknown', observed_at: observedAt, online: false }
      const sim = deviceAt(device, b, clock.now())
      const state = b.status_model === 'none' || sim.statusHidden ? 'unknown' : reportedState(sim.gate)
      return { state, observed_at: observedAt, online: true }
    },

    async sendCommand (device, cmd: CommandRequest): Promise<SendResult> {
      let b: Behaviour
      try {
        b = behaviourOf(device)
      } catch (err) {
        return { acked: false, error: err as ProviderError }
      }
      const simulate = simulateSchema.safeParse(cmd.params?.simulate)
      if (!simulate.success) {
        return { acked: false, error: new ProviderError('unsupported', 'Unknown params.simulate value', { detail: simulate.error.issues }) }
      }
      if (!capabilitiesFor(b).actions.includes(cmd.action)) {
        return { acked: false, error: new ProviderError('unsupported', `Action ${cmd.action} is not supported by this device`) }
      }
      const outcome = simulate.data

      if (outcome === 'timeout') {
        // The request never arrives, but the caller cannot know that: the send is ambiguous.
        await clock.sleep(DESCRIPTOR.timeouts.send_s * 1000)
        return { acked: false, error: new ProviderError('timeout', 'Simulated send timeout', { ambiguous: true }) }
      }
      await clock.sleep(b.latency_ms)
      if (!b.online || outcome === 'offline') {
        return { acked: false, error: new ProviderError('offline', 'Simulated device is offline') }
      }
      if (outcome === 'reject') {
        return { acked: false, error: new ProviderError('vendor_error', 'Simulated vendor rejection', { detail: { simulated: 'reject' } }) }
      }
      if (b.fail_rate > 0 && random() < b.fail_rate) {
        return { acked: false, error: new ProviderError('vendor_error', 'Simulated random failure', { detail: { simulated: 'fail_rate' } }) }
      }

      // Every action is one pulse on the simulated motor: `open` and `close` are state-checked by
      // the coordinator before it calls us (SPEC §7.1), and `close` is offered only where a pulse
      // can close (checked above).
      const now = clock.now()
      const sim = deviceAt(device, b, now)
      sim.gate = pulse(sim.gate, gateParams(b), now)
      sim.statusHidden = outcome === 'no_status'

      if (outcome === 'ambiguous') {
        // The pulse reached the device, but the reply was lost.
        return { acked: false, error: new ProviderError('timeout', 'Simulated lost reply after send', { ambiguous: true }) }
      }
      return { acked: b.verification_level !== 'none', provider_ref: `sim_${cmd.command_id}` }
    },

    async health (): Promise<ProviderHealth> {
      return { ok: true, checked_at: timestamp() }
    },
  }
}
