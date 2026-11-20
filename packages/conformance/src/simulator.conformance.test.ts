// The simulator must pass the conformance kit at 100% (SPEC §11 item 3).
import { manualClock, type DeviceRef } from '@flussctrl/core'
import { createSimulator } from '@flussctrl/provider-simulator'
import { defineConformanceSuite } from './index.ts'

const ref = (id: string, behaviour: Record<string, unknown>): DeviceRef => ({
  device_id: id, provider_ref: `sim-${id}`, channel: 'io:1', config: { behaviour },
})

defineConformanceSuite({
  name: 'simulator',
  setup: () => {
    const clock = manualClock()
    const provider = createSimulator({ clock, random: () => 1 })
    return {
      provider,
      devices: {
        closed: ref('dev_closed', {}),
        open: ref('dev_open', { initial_state: 'open', autoclose_s: null }),
        offline: ref('dev_offline', { online: false }),
      },
      timeout: { device: ref('dev_timeout', {}), params: { simulate: 'timeout' } },
      advance: (ms) => { clock.advance(ms) },
      now: () => clock.now(),
      capabilitiesFor: (device) => provider.capabilitiesFor(device),
    }
  },
})

// The same kit against the other gate shapes the simulator models, so a pulse-mode or status-model
// change cannot pass on the default device alone.
defineConformanceSuite({
  name: 'simulator (open_only, door lock, ack only)',
  setup: () => {
    const clock = manualClock()
    const provider = createSimulator({ clock, random: () => 1 })
    return {
      provider,
      devices: {
        closed: ref('dev_closed', { pulse_mode: 'open_only', travel_s: 20, autoclose_s: 30 }),
        open: ref('dev_open', { status_model: 'door_lock', initial_state: 'open', autoclose_s: null }),
        offline: ref('dev_offline', { online: false, status_model: 'none', verification_level: 'ack' }),
      },
      timeout: { device: ref('dev_timeout', { pulse_mode: 'open_only' }), params: { simulate: 'timeout' } },
      advance: (ms) => { clock.advance(ms) },
      now: () => clock.now(),
      capabilitiesFor: (device) => provider.capabilitiesFor(device),
    }
  },
})

// An open_only device offers no close: the kit checks that a close is refused, never sent.
defineConformanceSuite({
  name: 'simulator (open_only gate, close not offered)',
  setup: () => {
    const clock = manualClock()
    const provider = createSimulator({ clock, random: () => 1 })
    return {
      provider,
      devices: {
        closed: ref('dev_closed', { pulse_mode: 'open_only' }),
        open: ref('dev_open', { pulse_mode: 'open_only', initial_state: 'open', autoclose_s: null }),
        offline: ref('dev_offline', { pulse_mode: 'open_only', online: false }),
      },
      timeout: { device: ref('dev_timeout', { pulse_mode: 'open_only' }), params: { simulate: 'timeout' } },
      advance: (ms) => { clock.advance(ms) },
      now: () => clock.now(),
      capabilitiesFor: (device) => provider.capabilitiesFor(device),
    }
  },
})

// A fast gate opens and closes again inside one confirm window, so the kit must poll, not read once
// at the deadline.
defineConformanceSuite({
  name: 'simulator (fast gate, opens and autocloses inside the window)',
  setup: () => {
    const clock = manualClock()
    const provider = createSimulator({ clock, random: () => 1 })
    return {
      provider,
      devices: {
        closed: ref('dev_closed', { travel_s: 1, autoclose_s: 1 }),
        open: ref('dev_open', { travel_s: 1, initial_state: 'open', autoclose_s: null }),
        offline: ref('dev_offline', { online: false }),
      },
      timeout: { device: ref('dev_timeout', {}), params: { simulate: 'timeout' } },
      advance: (ms) => { clock.advance(ms) },
      now: () => clock.now(),
      capabilitiesFor: (device) => provider.capabilitiesFor(device),
    }
  },
})
