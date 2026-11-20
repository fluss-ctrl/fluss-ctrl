/**
 * The injected clock (CLAUDE.md "Testing"): time-dependent code takes a `Clock` instead of calling
 * `Date.now()` or `setTimeout` directly, so tests can control time.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number
  /** Resolves after `ms` milliseconds of this clock's time. */
  sleep(ms: number): Promise<void>
}

/** The real clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)) }),
}

/** A clock that only moves when told to. `sleep` moves it forward instead of waiting. */
export interface ManualClock extends Clock {
  /** Moves the clock forward by `ms` milliseconds. */
  advance(ms: number): void
  /** Sets the clock to `ms`; it never moves backwards. */
  set(ms: number): void
}

/**
 * Creates a manual clock starting at `startMs` (default 2026-11-04T00:00:00Z). `sleep(ms)` does not
 * wait: pending sleeps resume one at a time in deadline order, and the clock jumps to each deadline
 * as it resumes. A caller that sleeps again starts from the time it resumed at, so concurrent
 * sleepers overlap as they would in real time, and no test ever waits.
 */
export function manualClock (startMs = Date.UTC(2026, 10, 4)): ManualClock {
  let now = startMs
  const pending: Array<{ until: number, seq: number, resolve: () => void }> = []
  let seq = 0
  let draining = false

  const set = (ms: number): void => {
    if (!Number.isFinite(ms)) throw new RangeError('clock time must be finite')
    now = Math.max(now, ms)
  }

  // Each step runs as a macrotask, so the code a resumed sleeper runs next (microtasks, including
  // its next sleep) is registered before the following deadline is chosen.
  const step = (): void => {
    if (pending.length === 0) {
      draining = false
      return
    }
    pending.sort((a, b) => a.until - b.until || a.seq - b.seq)
    const next = pending.shift() as { until: number, resolve: () => void }
    set(next.until)
    next.resolve()
    setTimeout(step, 0)
  }

  return {
    now: () => now,
    set,
    advance: (ms) => {
      if (ms < 0) throw new RangeError('a clock cannot move backwards')
      set(now + ms)
    },
    sleep: (ms) => new Promise<void>((resolve) => {
      pending.push({ until: now + Math.max(0, ms), seq: seq++, resolve })
      if (!draining) {
        draining = true
        setTimeout(step, 0)
      }
    }),
  }
}
