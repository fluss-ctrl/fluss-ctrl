import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { advance, initialGate, pulse, reportedState, type GateParams, type GateState } from './gate.ts'

const toggle: GateParams = { pulse_mode: 'toggle', travel_ms: 12_000, autoclose_ms: 15_000 }
const openOnly: GateParams = { pulse_mode: 'open_only', travel_ms: 12_000, autoclose_ms: 15_000 }

describe('gate model, examples', () => {
  it('reports closed only after the full travel', () => {
    const open = advance(pulse(initialGate(toggle, 0, 'open'), toggle, 0), toggle, 0)
    expect(open.phase).toBe('closing')
    expect(reportedState(advance(open, toggle, 11_999))).toBe('open')
    expect(reportedState(advance(open, toggle, 12_000))).toBe('closed')
  })

  it('reports open as soon as a closed gate starts to move', () => {
    const s = pulse(initialGate(toggle, 0, 'closed'), toggle, 0)
    expect(s.phase).toBe('opening')
    expect(reportedState(s)).toBe('open')
  })

  it('closes itself after autoclose and then the travel', () => {
    const s = pulse(initialGate(toggle, 0, 'closed'), toggle, 0)
    // Fully open at 12 s, autoclose starts at 27 s, closed at 39 s.
    expect(advance(s, toggle, 26_999).phase).toBe('idle')
    expect(advance(s, toggle, 27_000).phase).toBe('closing')
    expect(reportedState(advance(s, toggle, 38_999))).toBe('open')
    expect(reportedState(advance(s, toggle, 39_000))).toBe('closed')
  })

  it('toggle: a pulse on a moving gate stops it, and the next pulse reverses it', () => {
    const opening = pulse(initialGate(toggle, 0, 'closed'), toggle, 0)
    const stopped = pulse(opening, toggle, 5_000)
    expect(stopped).toMatchObject({ phase: 'idle', position: 5_000, autoclose_at: null })
    expect(reportedState(stopped)).toBe('open')
    // A stopped gate does not autoclose.
    expect(advance(stopped, toggle, 1_000_000).position).toBe(5_000)
    const reversed = pulse(stopped, toggle, 10_000)
    expect(reversed.phase).toBe('closing')
    expect(reportedState(advance(reversed, toggle, 15_000))).toBe('closed')
  })

  it('toggle: a stopped closing gate opens on the next pulse', () => {
    const closing = pulse(initialGate(toggle, 0, 'open'), toggle, 0)
    const stopped = pulse(closing, toggle, 2_000)
    expect(pulse(stopped, toggle, 3_000).phase).toBe('opening')
  })

  it('open_only: a pulse on an open gate restarts autoclose and cannot close it', () => {
    const open = initialGate(openOnly, 0, 'open')
    expect(open.autoclose_at).toBe(15_000)
    const pulsed = pulse(open, openOnly, 10_000)
    expect(pulsed).toMatchObject({ phase: 'idle', autoclose_at: 25_000 })
    expect(reportedState(advance(pulsed, openOnly, 24_999))).toBe('open')
  })

  it('open_only: a pulse on a closing gate re-opens it, and on an opening gate changes nothing', () => {
    const closing = advance(initialGate(openOnly, 0, 'open'), openOnly, 20_000)
    expect(closing.phase).toBe('closing')
    expect(pulse(closing, openOnly, 20_000).phase).toBe('opening')
    const opening = pulse(initialGate(openOnly, 0, 'closed'), openOnly, 0)
    expect(pulse(opening, openOnly, 1_000)).toEqual(advance(opening, openOnly, 1_000))
  })

  it('without autoclose an open gate stays open', () => {
    const p: GateParams = { ...toggle, autoclose_ms: null }
    const s = pulse(initialGate(p, 0, 'closed'), p, 0)
    expect(advance(s, p, 10_000_000)).toMatchObject({ phase: 'idle', position: 12_000, autoclose_at: null })
    expect(initialGate(p, 0, 'open').autoclose_at).toBeNull()
    expect(pulse(initialGate({ ...p, pulse_mode: 'open_only' }, 0, 'open'), { ...p, pulse_mode: 'open_only' }, 5).autoclose_at).toBeNull()
  })

  it('a door lock (1 ms travel) releases at once and relocks after autoclose', () => {
    const lock: GateParams = { pulse_mode: 'toggle', travel_ms: 1, autoclose_ms: 5_000 }
    const s = pulse(initialGate(lock, 0, 'closed'), lock, 0)
    expect(reportedState(s)).toBe('open')
    expect(reportedState(advance(s, lock, 5_000))).toBe('open')
    expect(reportedState(advance(s, lock, 5_002))).toBe('closed')
    expect(reportedState(advance(pulse(s, lock, 1_000), lock, 1_001))).toBe('closed')
  })

  it('refuses a travel time under 1 ms', () => {
    expect(() => advance(initialGate(toggle, 0, 'closed'), { ...toggle, travel_ms: 0 }, 0)).toThrow(RangeError)
  })

  it('keeps the position valid when the travel time shrinks', () => {
    const open = initialGate(toggle, 0, 'open')
    const shorter: GateParams = { ...toggle, travel_ms: 6_000 }
    expect(advance(open, shorter, 0).position).toBe(6_000)
  })

  it('switching autoclose off cancels a pending autoclose, but not a close already under way', () => {
    const open = initialGate(toggle, 0, 'open')
    expect(open.autoclose_at).toBe(15_000)
    const noAutoclose: GateParams = { ...toggle, autoclose_ms: null }
    expect(advance(open, noAutoclose, 100_000)).toMatchObject({ phase: 'idle', position: 12_000, autoclose_at: null })
    const closing = advance(open, toggle, 20_000)
    expect(closing.phase).toBe('closing')
    expect(reportedState(advance(closing, noAutoclose, 27_000))).toBe('closed')
  })

  it('never evaluates before the state it was given', () => {
    const s = pulse(initialGate(toggle, 0, 'closed'), toggle, 5_000)
    expect(advance(s, toggle, 1_000)).toEqual(s)
  })
})

// --- Properties -----------------------------------------------------------------------------------

const paramsArb = (mode?: GateParams['pulse_mode']): fc.Arbitrary<GateParams> => fc.record({
  pulse_mode: mode === undefined ? fc.constantFrom('toggle', 'open_only') : fc.constant(mode),
  travel_ms: fc.integer({ min: 1, max: 30_000 }),
  autoclose_ms: fc.option(fc.integer({ min: 0, max: 60_000 }), { nil: null }),
})

/** A history: a starting position, then pulses separated by random gaps. */
const historyArb = fc.record({
  initial: fc.constantFrom<'open' | 'closed'>('open', 'closed'),
  gaps: fc.array(fc.integer({ min: 0, max: 60_000 }), { maxLength: 25 }),
})

function play (p: GateParams, h: { initial: 'open' | 'closed', gaps: number[] }, visit?: (before: GateState, after: GateState) => void): GateState {
  let s = initialGate(p, 0, h.initial)
  let t = 0
  for (const gap of h.gaps) {
    t += gap
    const before = advance(s, p, t)
    s = pulse(s, p, t)
    visit?.(before, s)
  }
  return s
}

describe('gate model, properties', () => {
  it('open_only: a pulse never leaves the gate closed, and it stays open for at least autoclose plus travel', () => {
    const p = paramsArb('open_only')
    fc.assert(fc.property(p, historyArb, fc.integer({ min: 0, max: 200_000 }), (params, history, later) => {
      play(params, history, (_before, after) => {
        expect(reportedState(after)).toBe('open')
        const staysOpenFor = params.autoclose_ms === null ? Infinity : params.autoclose_ms + params.travel_ms
        if (later < staysOpenFor) expect(reportedState(advance(after, params, after.at + later))).toBe('open')
      })
    }))
  })

  it('toggle: a pulse on a moving gate stops it where it is', () => {
    fc.assert(fc.property(paramsArb('toggle'), historyArb, (params, history) => {
      play(params, history, (before, after) => {
        if (before.phase !== 'idle') expect(after).toMatchObject({ phase: 'idle', position: before.position, autoclose_at: null })
      })
    }))
  })

  it('reports closed only when stationary at the end of its travel, and the position stays in range', () => {
    fc.assert(fc.property(paramsArb(), historyArb, fc.integer({ min: 0, max: 200_000 }), (params, history, later) => {
      const check = (s: GateState): void => {
        expect(s.position).toBeGreaterThanOrEqual(0)
        expect(s.position).toBeLessThanOrEqual(params.travel_ms)
        expect(reportedState(s) === 'closed').toBe(s.phase === 'idle' && s.position === 0)
      }
      const end = play(params, history, (before, after) => { check(before); check(after) })
      check(advance(end, params, end.at + later))
    }))
  })

  it('from closed, a pulse shows open, and the gate is fully open exactly one travel later', () => {
    fc.assert(fc.property(paramsArb(), fc.integer({ min: 0, max: 1_000_000 }), (params, t) => {
      const s = pulse(initialGate(params, 0, 'closed'), params, t)
      expect(reportedState(s)).toBe('open')
      expect(advance(s, params, t + params.travel_ms - 1).position).toBeLessThan(params.travel_ms)
      // With an autoclose of 0 the gate starts closing the moment it arrives.
      expect(advance(s, params, t + params.travel_ms)).toMatchObject({ phase: params.autoclose_ms === 0 ? 'closing' : 'idle', position: params.travel_ms })
    }))
  })

  it('toggle: an open gate pulsed closed reports closed exactly one travel later, not before', () => {
    fc.assert(fc.property(paramsArb('toggle'), fc.integer({ min: 0, max: 1_000_000 }), (params, t) => {
      const s = pulse(initialGate({ ...params, autoclose_ms: null }, 0, 'open'), params, t)
      expect(reportedState(advance(s, params, t + params.travel_ms - 1))).toBe('open')
      expect(reportedState(advance(s, params, t + params.travel_ms))).toBe('closed')
    }))
  })

  it('evaluating in steps gives the same state as evaluating once', () => {
    fc.assert(fc.property(paramsArb(), historyArb, fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 0, max: 100_000 }), (params, history, a, b) => {
      const s = play(params, history)
      expect(advance(advance(s, params, s.at + a), params, s.at + a + b)).toEqual(advance(s, params, s.at + a + b))
    }))
  })
})
