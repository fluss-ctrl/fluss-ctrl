// Provider conformance kit (SPEC §11 item 3): one Vitest suite, parameterised by provider. A
// provider package calls `defineConformanceSuite` from a test file with a target that knows how to
// set up its scenarios (the simulator directly; real providers on recorded fixtures).
//
// Phase 0 covers status read, each supported action, already-in-state, offline and timeout mapping.
// Verification outcomes, claim/link, unlink, ingest, per-action windows under the coordinator,
// count_limited reservation and emergency behaviour join as their phases build them.
import {
  COMMAND_ACTIONS,
  isProviderError,
  type CommandAction,
  type CommandRequest,
  type DeviceRef,
  type DeviceState,
  type Provider,
  type ProviderCapabilities,
} from '@flussctrl/core'
import { beforeEach, describe, expect, it } from 'vitest'

export const packageName = '@flussctrl/conformance'

export interface ConformanceContext {
  readonly provider: Provider
  readonly devices: {
    /** Online, reports status, stationary and fully closed. */
    readonly closed: DeviceRef
    /** Online, reports status, stationary and fully open, and does not close by itself in the test. */
    readonly open: DeviceRef
    /** Unreachable. */
    readonly offline: DeviceRef
  }
  /** A device and command params whose send times out (a simulator flag, or a recorded fixture). */
  readonly timeout: { readonly device: DeviceRef, readonly params?: Readonly<Record<string, unknown>> }
  /** Moves time forward by `ms`: a manual clock on fixtures, a real wait on a bench. */
  advance(ms: number): void | Promise<void>
  /** The current time in ms, on the same clock `advance` moves (status reads may move it too). */
  now(): number
  /** The device's capabilities, where they differ from the descriptor's defaults. */
  capabilitiesFor?(device: DeviceRef): ProviderCapabilities
}

export interface ConformanceTarget {
  readonly name: string
  /** Called before every test, so each test starts from fresh scenarios. */
  setup(): ConformanceContext | Promise<ConformanceContext>
}

let sequence = 0
function command (action: CommandAction, params?: Readonly<Record<string, unknown>>): CommandRequest {
  sequence += 1
  return { command_id: `cmd_conformance_${sequence}`, action, ...(params === undefined ? {} : { params }) }
}

function isTimestamp (value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value))
}

/** Where each action must leave a device that started stationary, and from which state it starts. */
const ACTION_CASES: Record<CommandAction, { from: 'closed' | 'open', expect: 'open' | 'closed' }> = {
  trigger: { from: 'closed', expect: 'open' },
  open: { from: 'closed', expect: 'open' },
  close: { from: 'open', expect: 'closed' },
}

export function defineConformanceSuite (target: ConformanceTarget): void {
  describe(`provider conformance: ${target.name}`, () => {
    let ctx: ConformanceContext
    const caps = (device: DeviceRef): ProviderCapabilities => ctx.capabilitiesFor?.(device) ?? ctx.provider.describe().capabilities

    // Polls status through the action's confirm window, as the coordinator does (SPEC §7.1), and
    // returns the expected state as soon as it is seen, or the last state read at the deadline. A
    // fast gate may reach the state and leave it again before the window ends.
    async function observeWithinWindow (device: DeviceRef, action: CommandAction, expected: DeviceState): Promise<DeviceState> {
      const pollMs = Math.max(1, caps(device).poll_status_interval_s * 1000)
      const deadline = ctx.now() + ctx.provider.describe().timeouts.confirm_window_s[action] * 1000
      let state = (await ctx.provider.getStatus(device)).state
      while (state !== expected && ctx.now() < deadline) {
        await ctx.advance(Math.min(pollMs, deadline - ctx.now()))
        state = (await ctx.provider.getStatus(device)).state
      }
      return state
    }

    beforeEach(async () => {
      ctx = await target.setup()
    })

    describe('descriptor and health', () => {
      it('describes itself consistently with the provider', () => {
        const d = ctx.provider.describe()
        expect(d.code).toBe(ctx.provider.code)
        expect(d.onboarding).toBe(ctx.provider.onboarding)
        expect(d.stability).toBe(ctx.provider.stability)
        expect(d.capabilities.actions.length).toBeGreaterThan(0)
        for (const a of d.capabilities.actions) expect(COMMAND_ACTIONS).toContain(a)
        expect(d.capabilities.ack).toBe(d.capabilities.verification_level !== 'none')
        if (d.capabilities.verification_level === 'status') expect(d.capabilities.status).toBe(true)
        expect(d.timeouts.send_s).toBeGreaterThan(0)
        for (const a of COMMAND_ACTIONS) expect(d.timeouts.confirm_window_s[a]).toBeGreaterThan(0)
        expect(d.docs_url).toMatch(/^https:\/\//)
      })

      it('accepts its own scenario devices against config_schema', () => {
        const schema = ctx.provider.describe().config_schema
        for (const ref of [ctx.devices.closed, ctx.devices.open, ctx.devices.offline]) {
          expect(schema.safeParse(ref.config).success).toBe(true)
        }
      })

      it('reports health', async () => {
        const h = await ctx.provider.health()
        expect(h.ok).toBe(true)
        expect(isTimestamp(h.checked_at)).toBe(true)
      })
    })

    describe('status read', () => {
      it('reads a closed device as online and closed, with an RFC 3339 timestamp', async () => {
        const s = await ctx.provider.getStatus(ctx.devices.closed)
        expect(s).toMatchObject({ online: true, state: 'closed' })
        expect(isTimestamp(s.observed_at)).toBe(true)
      })

      it('reads an open device as open', async () => {
        expect(await ctx.provider.getStatus(ctx.devices.open)).toMatchObject({ online: true, state: 'open' })
      })
    })

    describe('each supported action', () => {
      for (const action of COMMAND_ACTIONS) {
        const c = ACTION_CASES[action]
        it(`${action}: acknowledged as declared and observed as ${c.expect} within its confirm window, or refused as unsupported where not offered`, async () => {
          const device = ctx.devices[c.from]
          const deviceCaps = caps(device)
          if (!deviceCaps.actions.includes(action)) {
            // An action the device does not offer never reaches it (SPEC §7: never close an open_only gate).
            const refused = await ctx.provider.sendCommand(device, command(action))
            expect(refused).toMatchObject({ acked: false, error: { code: 'unsupported', ambiguous: false } })
            return
          }
          const result = await ctx.provider.sendCommand(device, command(action))
          expect(result.error).toBeUndefined()
          expect(result.acked).toBe(deviceCaps.ack)
          if (!deviceCaps.status) return
          expect(await observeWithinWindow(device, action, c.expect)).toBe(c.expect)
        })
      }
    })

    describe('already in state', () => {
      // The coordinator answers `confirmed` with `already_in_state` and sends nothing when a fresh
      // read shows the target state (SPEC §7.1). That needs a read that matches the device and has
      // no side effect.
      it('reads the target state for a device already in it, and reading changes nothing', async () => {
        for (const [ref, state] of [[ctx.devices.open, 'open'], [ctx.devices.closed, 'closed']] as const) {
          expect((await ctx.provider.getStatus(ref)).state).toBe(state)
          await ctx.advance(1_000)
          expect((await ctx.provider.getStatus(ref)).state).toBe(state)
        }
      })

      it('reads open after an open has completed, so a repeat open needs no send', async () => {
        const device = ctx.devices.closed
        const action: CommandAction = caps(device).actions.includes('open') ? 'open' : 'trigger'
        await ctx.provider.sendCommand(device, command(action))
        expect(await observeWithinWindow(device, action, 'open')).toBe('open')
      })
    })

    describe('offline', () => {
      it('reads an unreachable device as offline instead of throwing', async () => {
        expect((await ctx.provider.getStatus(ctx.devices.offline)).online).toBe(false)
      })

      it('maps a send to an unreachable device to offline, not ambiguous', async () => {
        const result = await ctx.provider.sendCommand(ctx.devices.offline, command('trigger'))
        expect(result.acked).toBe(false)
        expect(isProviderError(result.error)).toBe(true)
        expect(result.error).toMatchObject({ code: 'offline', ambiguous: false })
      })
    })

    describe('timeout', () => {
      it('maps a send timeout to timeout, marked ambiguous, without throwing', async () => {
        const result = await ctx.provider.sendCommand(ctx.timeout.device, command('trigger', ctx.timeout.params))
        expect(result.acked).toBe(false)
        expect(isProviderError(result.error)).toBe(true)
        expect(result.error).toMatchObject({ code: 'timeout', ambiguous: true })
      })
    })
  })
}
