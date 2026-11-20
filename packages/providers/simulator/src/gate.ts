// The simulated motor (SPEC §10.2). Pure functions over an immutable state, evaluated lazily at
// the injected clock's time: nothing runs on a timer, so the model survives being re-created and
// tests can jump to any instant.

export type PulseMode = 'toggle' | 'open_only'
export type Phase = 'idle' | 'opening' | 'closing'
export type Direction = 'opening' | 'closing'

export interface GateParams {
  readonly pulse_mode: PulseMode
  /**
   * Full travel time, at least 1 ms: a door lock is modelled as a 1 ms travel, so that "fully open"
   * and "closed" are never the same position.
   */
  readonly travel_ms: number
  /** Time a fully open gate waits before closing itself; null for no autoclose. */
  readonly autoclose_ms: number | null
}

export interface GateState {
  /** Travel from fully closed, in ms: 0 is closed, `travel_ms` is fully open. */
  readonly position: number
  readonly phase: Phase
  /** Clock time this state describes. */
  readonly at: number
  /** The last way the gate moved; a toggle pulse on a stopped gate goes the other way. */
  readonly last_direction: Direction
  /** When an idle, fully open gate starts closing itself. */
  readonly autoclose_at: number | null
}

export function initialGate (params: GateParams, at: number, initial: 'open' | 'closed'): GateState {
  return initial === 'open'
    ? { position: params.travel_ms, phase: 'idle', at, last_direction: 'opening', autoclose_at: params.autoclose_ms === null ? null : at + params.autoclose_ms }
    : { position: 0, phase: 'idle', at, last_direction: 'closing', autoclose_at: null }
}

/** The state at `now` (never earlier than `state.at`), with every arrival and autoclose applied in order. */
export function advance (state: GateState, params: GateParams, now: number): GateState {
  let s = clampToParams(state, params)
  const target = Math.max(now, s.at)
  for (;;) {
    if (s.phase === 'opening') {
      const arrives = s.at + (params.travel_ms - s.position)
      if (arrives > target) return { ...s, position: s.position + (target - s.at), at: target }
      s = { ...s, phase: 'idle', position: params.travel_ms, at: arrives, autoclose_at: params.autoclose_ms === null ? null : arrives + params.autoclose_ms }
    } else if (s.phase === 'closing') {
      const arrives = s.at + s.position
      if (arrives > target) return { ...s, position: s.position - (target - s.at), at: target }
      s = { ...s, phase: 'idle', position: 0, at: arrives, autoclose_at: null }
    } else {
      if (s.autoclose_at === null || s.autoclose_at > target) return { ...s, at: target }
      s = { ...s, phase: 'closing', at: s.autoclose_at, last_direction: 'closing', autoclose_at: null }
    }
  }
}

/**
 * One trigger pulse at `now` (SPEC §4 `controls.pulse_mode`):
 * - `toggle`: a stationary gate moves the other way; a moving gate stops.
 * - `open_only`: the gate opens or re-opens; an open gate restarts its autoclose. Only autoclose
 *   closes it.
 */
export function pulse (state: GateState, params: GateParams, now: number): GateState {
  const s = advance(state, params, now)
  const fullyOpen = s.position === params.travel_ms
  let next: GateState
  if (params.pulse_mode === 'open_only') {
    if (s.phase === 'opening') next = s
    else if (s.phase === 'idle' && fullyOpen) next = { ...s, autoclose_at: params.autoclose_ms === null ? null : s.at + params.autoclose_ms }
    else next = { ...s, phase: 'opening', last_direction: 'opening', autoclose_at: null }
  } else if (s.phase !== 'idle') {
    next = { ...s, phase: 'idle', autoclose_at: null }
  } else {
    const direction: Direction = s.position === 0 ? 'opening' : fullyOpen ? 'closing' : opposite(s.last_direction)
    next = { ...s, phase: direction, last_direction: direction, autoclose_at: null }
  }
  return next
}

/** What a status input reports: `closed` only when the gate is stationary at the end of its travel. */
export function reportedState (state: GateState): 'open' | 'closed' {
  return state.phase === 'idle' && state.position === 0 ? 'closed' : 'open'
}

function opposite (d: Direction): Direction {
  return d === 'opening' ? 'closing' : 'opening'
}

// A device's behaviour can change between calls (PATCH /devices/{id}); keep the state valid.
// Switching autoclose off cancels a pending autoclose; a close already under way carries on.
function clampToParams (s: GateState, params: GateParams): GateState {
  if (!(params.travel_ms >= 1)) throw new RangeError('travel_ms must be at least 1')
  let next = s
  if (params.autoclose_ms === null && next.autoclose_at !== null) next = { ...next, autoclose_at: null }
  if (next.position > params.travel_ms) next = { ...next, position: params.travel_ms }
  return next
}
