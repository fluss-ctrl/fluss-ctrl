import { manualClock, ProviderError, type DeviceRef } from '@flussctrl/core'
import { describe, expect, it } from 'vitest'
import type { Behaviour } from './behaviour.ts'
import { createSimulator } from './simulator.ts'

const START = Date.UTC(2026, 10, 4)

function device (behaviour: Partial<Behaviour> = {}, id = 'dev_1'): DeviceRef {
  return { device_id: id, provider_ref: 'sim-unit-1', channel: 'io:1', config: { behaviour } }
}

function setup (random = () => 0.99) {
  const clock = manualClock(START)
  return { clock, sim: createSimulator({ clock, random }) }
}

const cmd = (action: 'trigger' | 'open' | 'close', simulate?: string) => ({
  command_id: 'cmd_1', action, ...(simulate === undefined ? {} : { params: { simulate } }),
})

describe('simulator', () => {
  it('describes itself with the SPEC §10.1 defaults', () => {
    const { sim } = setup()
    const d = sim.describe()
    expect(d).toMatchObject({ code: 'simulator', onboarding: 'claim_code', stability: 'official' })
    expect(d.capabilities).toMatchObject({ actions: ['trigger', 'open', 'close'], status: true, ack: true, verification_level: 'status', min_command_interval_s: 2 })
    expect(d.timeouts).toEqual({ send_s: 8, confirm_window_s: { trigger: 10, open: 10, close: 45 } })
    expect(d.config_schema.safeParse({}).success).toBe(true)
    expect(Object.keys(d.capabilities)).not.toContain('hold')
  })

  it('takes the spec defaults for a device with no behaviour', async () => {
    const { clock, sim } = setup()
    const ref: DeviceRef = { device_id: 'dev_d', provider_ref: 'u', channel: 'io:1', config: {} }
    const status = await sim.getStatus(ref)
    expect(status).toEqual({ state: 'closed', online: true, observed_at: new Date(START + 300).toISOString() })
    expect(clock.now()).toBe(START + 300)
  })

  it('waits latency_ms on every call', async () => {
    const { clock, sim } = setup()
    await sim.sendCommand(device({ latency_ms: 1_000 }), cmd('trigger'))
    expect(clock.now()).toBe(START + 1_000)
  })

  it('opens on a trigger and reports closed only after travel when closed again', async () => {
    const { clock, sim } = setup()
    const ref = device({ latency_ms: 0, autoclose_s: null })
    expect(await sim.sendCommand(ref, cmd('trigger'))).toEqual({ acked: true, provider_ref: 'sim_cmd_1' })
    expect((await sim.getStatus(ref)).state).toBe('open')
    clock.advance(12_000)
    await sim.sendCommand(ref, cmd('close'))
    clock.advance(11_999)
    expect((await sim.getStatus(ref)).state).toBe('open')
    clock.advance(1)
    expect((await sim.getStatus(ref)).state).toBe('closed')
  })

  it('autocloses after autoclose_s', async () => {
    const { clock, sim } = setup()
    const ref = device({ latency_ms: 0, travel_s: 2, autoclose_s: 5 })
    await sim.sendCommand(ref, cmd('open'))
    clock.advance(8_999)
    expect((await sim.getStatus(ref)).state).toBe('open')
    clock.advance(1)
    expect((await sim.getStatus(ref)).state).toBe('closed')
  })

  it('starts a device from initial_state', async () => {
    const { sim } = setup()
    expect((await sim.getStatus(device({ initial_state: 'open', latency_ms: 0 }))).state).toBe('open')
  })

  it('keeps devices apart, and unlink resets one', async () => {
    const { sim } = setup()
    const a = device({ latency_ms: 0 }, 'dev_a')
    const b = device({ latency_ms: 0 }, 'dev_b')
    await sim.sendCommand(a, cmd('trigger'))
    expect((await sim.getStatus(a)).state).toBe('open')
    expect((await sim.getStatus(b)).state).toBe('closed')
    await sim.unlinkDevice(a)
    expect((await sim.getStatus(a)).state).toBe('closed')
  })

  describe('capabilities', () => {
    it('never offers close on an open_only device, and refuses it if sent', async () => {
      const { clock, sim } = setup()
      const ref = device({ pulse_mode: 'open_only', initial_state: 'open' })
      expect(sim.capabilitiesFor(ref).actions).toEqual(['trigger', 'open'])
      const res = await sim.sendCommand(ref, cmd('close'))
      expect(res.acked).toBe(false)
      expect(res.error).toMatchObject({ code: 'unsupported', ambiguous: false })
      expect(clock.now()).toBe(START)
    })

    it('does not offer close without status', () => {
      const { sim } = setup()
      const caps = sim.capabilitiesFor(device({ status_model: 'none', verification_level: 'ack' }))
      expect(caps).toMatchObject({ actions: ['trigger', 'open'], status: false, ack: true, verification_level: 'ack' })
    })

    it('declares no ack at verification level none', async () => {
      const { sim } = setup()
      const ref = device({ status_model: 'none', verification_level: 'none' })
      expect(sim.capabilitiesFor(ref)).toMatchObject({ ack: false, verification_level: 'none' })
      expect(await sim.sendCommand(ref, cmd('trigger'))).toEqual({ acked: false, provider_ref: 'sim_cmd_1' })
      expect((await sim.getStatus(ref)).state).toBe('unknown')
    })
  })

  describe('invalid configuration', () => {
    it('rejects a status level without a status model', async () => {
      const { sim } = setup()
      const ref = device({ status_model: 'none', verification_level: 'status' })
      await expect(sim.getStatus(ref)).rejects.toMatchObject({ code: 'unsupported' })
      const res = await sim.sendCommand(ref, cmd('trigger'))
      expect(res.error).toBeInstanceOf(ProviderError)
      expect(res.error?.code).toBe('unsupported')
      expect(() => sim.capabilitiesFor(ref)).toThrow(ProviderError)
    })

    it('rejects an unknown params.simulate', async () => {
      const { sim } = setup()
      const res = await sim.sendCommand(device(), cmd('trigger', 'explode'))
      expect(res.error?.code).toBe('unsupported')
    })
  })

  describe('forced outcomes (params.simulate)', () => {
    it('timeout: waits the send timeout, is ambiguous, and the gate does not move', async () => {
      const { clock, sim } = setup()
      const ref = device({ latency_ms: 0 })
      const res = await sim.sendCommand(ref, cmd('trigger', 'timeout'))
      expect(res).toMatchObject({ acked: false, error: { code: 'timeout', ambiguous: true } })
      expect(clock.now()).toBe(START + 8_000)
      expect((await sim.getStatus(ref)).state).toBe('closed')
    })

    it('ambiguous: the reply is lost but the gate moves', async () => {
      const { sim } = setup()
      const ref = device({ latency_ms: 0 })
      const res = await sim.sendCommand(ref, cmd('trigger', 'ambiguous'))
      expect(res).toMatchObject({ acked: false, error: { code: 'timeout', ambiguous: true } })
      expect((await sim.getStatus(ref)).state).toBe('open')
    })

    it('offline: refused, not ambiguous, and the gate does not move', async () => {
      const { sim } = setup()
      const ref = device({ latency_ms: 0 })
      const res = await sim.sendCommand(ref, cmd('trigger', 'offline'))
      expect(res).toMatchObject({ acked: false, error: { code: 'offline', ambiguous: false } })
      expect((await sim.getStatus(ref)).state).toBe('closed')
    })

    it('reject: a vendor error with detail, and the gate does not move', async () => {
      const { sim } = setup()
      const ref = device({ latency_ms: 0 })
      const res = await sim.sendCommand(ref, cmd('open', 'reject'))
      expect(res).toMatchObject({ acked: false, error: { code: 'vendor_error', ambiguous: false, detail: { simulated: 'reject' } } })
      expect((await sim.getStatus(ref)).state).toBe('closed')
    })

    it('no_status: acked and moved, but status reads unknown until the next command', async () => {
      const { clock, sim } = setup()
      const ref = device({ latency_ms: 0, autoclose_s: null })
      expect(await sim.sendCommand(ref, cmd('trigger', 'no_status'))).toMatchObject({ acked: true })
      expect((await sim.getStatus(ref)).state).toBe('unknown')
      clock.advance(12_000)
      await sim.sendCommand(ref, cmd('trigger'))
      expect((await sim.getStatus(ref)).state).toBe('open')
      clock.advance(12_000)
      expect((await sim.getStatus(ref)).state).toBe('closed')
    })

    it('no_status: the next command clears hidden status even when it fails', async () => {
      const { clock, sim } = setup()
      const ref = device({ latency_ms: 0, autoclose_s: null })
      await sim.sendCommand(ref, cmd('trigger', 'no_status'))
      clock.advance(12_000)
      expect((await sim.sendCommand(ref, cmd('trigger', 'reject'))).error).toMatchObject({ code: 'vendor_error' })
      expect((await sim.getStatus(ref)).state).toBe('open')
    })
  })

  describe('behaviour', () => {
    it('an offline device reads offline and refuses commands', async () => {
      const { sim } = setup()
      const ref = device({ online: false })
      expect(await sim.getStatus(ref)).toMatchObject({ online: false, state: 'unknown' })
      expect((await sim.sendCommand(ref, cmd('trigger'))).error).toMatchObject({ code: 'offline', ambiguous: false })
    })

    it('fail_rate fails a send when the random draw is under it', async () => {
      const draws = [0.1, 0.9]
      const clock = manualClock(START)
      const sim = createSimulator({ clock, random: () => draws.shift() ?? 0.9 })
      const ref = device({ fail_rate: 0.5, latency_ms: 0 })
      expect((await sim.sendCommand(ref, cmd('trigger'))).error).toMatchObject({ code: 'vendor_error', ambiguous: false })
      expect((await sim.getStatus(ref)).state).toBe('closed')
      expect(await sim.sendCommand(ref, cmd('trigger'))).toMatchObject({ acked: true })
    })

    it('fail_rate applies only to sends without a forced outcome', async () => {
      const { sim } = setup(() => 0)
      const ambiguous = device({ fail_rate: 1, latency_ms: 0 }, 'dev_a')
      expect((await sim.sendCommand(ambiguous, cmd('trigger', 'ambiguous'))).error).toMatchObject({ code: 'timeout', ambiguous: true })
      expect((await sim.getStatus(ambiguous)).state).toBe('open')
      const hidden = device({ fail_rate: 1, latency_ms: 0 }, 'dev_b')
      expect(await sim.sendCommand(hidden, cmd('trigger', 'no_status'))).toMatchObject({ acked: true })
      expect((await sim.getStatus(hidden)).state).toBe('unknown')
    })

    it('a door lock releases at once and relocks after autoclose_s', async () => {
      const { clock, sim } = setup()
      const ref = device({ status_model: 'door_lock', autoclose_s: 5, latency_ms: 0 })
      await sim.sendCommand(ref, cmd('open'))
      expect((await sim.getStatus(ref)).state).toBe('open')
      clock.advance(5_002)
      expect((await sim.getStatus(ref)).state).toBe('closed')
    })
  })

  it('reports health', async () => {
    const { sim } = setup()
    expect(await sim.health()).toEqual({ ok: true, checked_at: new Date(START).toISOString() })
  })

  it('uses the system clock and Math.random by default', async () => {
    const sim = createSimulator()
    const before = Date.now()
    const status = await sim.getStatus(device({ latency_ms: 0 }))
    expect(Date.parse(status.observed_at)).toBeGreaterThanOrEqual(before)
  })
})
