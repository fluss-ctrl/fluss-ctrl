import { manualClock, type DeviceRef, type DeviceState, type Provider } from '@flussctrl/core'
import { describe, expect, it } from 'vitest'
import { defineConformanceSuite, observeWithinWindow, packageName } from './index.ts'

describe('@flussctrl/conformance', () => {
  it('is wired into the workspace', () => {
    expect(packageName).toBe('@flussctrl/conformance')
    expect(typeof defineConformanceSuite).toBe('function')
  })
})

describe('observeWithinWindow', () => {
  const device: DeviceRef = { device_id: 'dev_x', provider_ref: 'x', channel: 'io:1', config: {} }

  // A provider whose status reads take `latencyMs` and return the scripted states in turn.
  function scripted (states: DeviceState[], latencyMs: number) {
    const clock = manualClock(0)
    const provider = {
      getStatus: async () => {
        clock.advance(latencyMs)
        return { state: states.shift() ?? 'unknown', observed_at: new Date(clock.now()).toISOString(), online: true }
      },
    } as unknown as Provider
    return { provider, now: () => clock.now(), advance: (ms: number) => { clock.advance(ms) } }
  }

  it('returns the expected state as soon as a read inside the window shows it', async () => {
    const ctx = scripted(['closed', 'open', 'closed'], 100)
    expect(await observeWithinWindow(ctx, { poll_status_interval_s: 1 }, device, 10_000, 'open')).toBe('open')
    expect(ctx.now()).toBe(1_200)
  })

  it('does not accept a read that completes after the deadline', async () => {
    // Window 1 s, reads take 600 ms: the first read ends at 600 ms (closed); the second starts at
    // 1 s and ends at 1.6 s, outside the window, so its "open" must not count.
    const ctx = scripted(['closed', 'open'], 600)
    expect(await observeWithinWindow(ctx, { poll_status_interval_s: 1 }, device, 1_000, 'open')).toBe('closed')
  })

  it('returns unknown when no read completes inside the window', async () => {
    const ctx = scripted(['open'], 2_000)
    expect(await observeWithinWindow(ctx, { poll_status_interval_s: 1 }, device, 1_000, 'open')).toBe('unknown')
  })
})
