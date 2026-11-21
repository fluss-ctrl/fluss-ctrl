import type { TokenBucketPolicy } from '@flussctrl/core'
import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { durableRateLimiter, type TokenBucketLimiter } from './rate-limiter.ts'

const policy: TokenBucketPolicy = { name: 'test', capacity: 3, refillPerSecond: 1 }
let n = 0
const freshKey = () => `cli_test_${++n}_${crypto.randomUUID()}`

describe('TokenBucketLimiter Durable Object', () => {
  it('allows up to capacity, then refuses with a retry-after', async () => {
    const limiter = durableRateLimiter(env.RATE_LIMITER, policy, 'enam')
    const key = freshKey()
    const results = []
    for (let i = 0; i < 4; i++) results.push(await limiter.consume(key))
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
    expect(results[3]?.retryAfterMs).toBeGreaterThan(0)
    expect(results[3]?.retryAfterMs).toBeLessThanOrEqual(1000)
  })

  it('serialises concurrent calls on one key: never more than capacity', async () => {
    const limiter = durableRateLimiter(env.RATE_LIMITER, { ...policy, refillPerSecond: 0.001 }, 'enam')
    const key = freshKey()
    const results = await Promise.all(Array.from({ length: 10 }, async () => await limiter.consume(key)))
    expect(results.filter((r) => r.allowed)).toHaveLength(3)
  })

  it('keeps separate buckets per key and per policy', async () => {
    const key = freshKey()
    const a = durableRateLimiter(env.RATE_LIMITER, policy, 'enam')
    const b = durableRateLimiter(env.RATE_LIMITER, { ...policy, name: 'other' }, 'enam')
    await a.consume(key, 3)
    expect((await a.consume(key)).allowed).toBe(false)
    expect((await b.consume(key)).allowed).toBe(true)
    expect((await a.consume(freshKey())).allowed).toBe(true)
  })

  it('keeps the bucket in storage across an eviction and refills from the stored time', async () => {
    const limiter = durableRateLimiter(env.RATE_LIMITER, policy, 'enam')
    const key = freshKey()
    await limiter.consume(key, 3)
    const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(`test:${key}`))
    await evictDurableObject(stub)
    expect((await limiter.consume(key)).allowed).toBe(false)

    // Move the stored timestamp two seconds back instead of waiting.
    await runInDurableObject(stub, async (_i: TokenBucketLimiter, state) => {
      const bucket = await state.storage.get<{ tokens: number, updatedAt: number }>('bucket')
      await state.storage.put('bucket', { tokens: bucket?.tokens ?? 0, updatedAt: (bucket?.updatedAt ?? 0) - 2000 })
    })
    expect((await limiter.consume(key, 2)).allowed).toBe(true)
  })

  it('rejects a bad policy, cost or key', async () => {
    expect(() => durableRateLimiter(env.RATE_LIMITER, { ...policy, capacity: 0 }, 'enam')).toThrow(RangeError)
    const limiter = durableRateLimiter(env.RATE_LIMITER, policy, 'enam')
    await expect(limiter.consume('')).rejects.toThrow(RangeError)
    await expect(limiter.consume(freshKey(), 4)).rejects.toThrow('cost')
  })
})
