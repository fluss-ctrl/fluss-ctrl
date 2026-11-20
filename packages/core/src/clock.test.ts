import { describe, expect, it } from 'vitest'
import { manualClock, systemClock } from './clock.ts'

describe('manualClock', () => {
  it('starts where told and moves only when told', () => {
    const clock = manualClock(1_000)
    expect(clock.now()).toBe(1_000)
    clock.advance(500)
    expect(clock.now()).toBe(1_500)
    clock.set(10_000)
    expect(clock.now()).toBe(10_000)
  })

  it('defaults to a fixed instant so tests are deterministic', () => {
    expect(manualClock().now()).toBe(Date.UTC(2026, 10, 4))
  })

  it('never moves backwards', () => {
    const clock = manualClock(5_000)
    clock.set(1_000)
    expect(clock.now()).toBe(5_000)
    expect(() => clock.advance(-1)).toThrow(RangeError)
    expect(() => clock.set(Number.NaN)).toThrow(RangeError)
  })

  it('advances on sleep, and overlaps concurrent sleeps as real time would', async () => {
    const clock = manualClock(0)
    await clock.sleep(300)
    expect(clock.now()).toBe(300)
    await Promise.all([clock.sleep(100), clock.sleep(200)])
    expect(clock.now()).toBe(500)
    await clock.sleep(-5)
    expect(clock.now()).toBe(500)
  })

  it('resumes chained sleeps in deadline order, each starting from when its caller resumed', async () => {
    const clock = manualClock(0)
    const order: string[] = []
    const a = (async () => {
      await clock.sleep(100)
      order.push(`a1@${clock.now()}`)
      await clock.sleep(100)
      order.push(`a2@${clock.now()}`)
    })()
    const b = (async () => {
      await clock.sleep(1_000)
      order.push(`b@${clock.now()}`)
    })()
    await Promise.all([a, b])
    expect(order).toEqual(['a1@100', 'a2@200', 'b@1000'])
    expect(clock.now()).toBe(1_000)
  })

  it('resumes sleeps with the same deadline in the order they started', async () => {
    const clock = manualClock(0)
    const order: number[] = []
    await Promise.all([1, 2, 3].map(async (n) => { await clock.sleep(50); order.push(n) }))
    expect(order).toEqual([1, 2, 3])
  })
})

describe('systemClock', () => {
  it('reads real time and sleeps', async () => {
    const before = Date.now()
    await systemClock.sleep(1)
    expect(systemClock.now()).toBeGreaterThanOrEqual(before)
  })
})
