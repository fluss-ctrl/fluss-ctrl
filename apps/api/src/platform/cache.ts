// Cache port on Workers KV. KV is eventually consistent (about a minute), so this cache is for data
// that is safe to serve stale only; see packages/core/src/platform/cache.ts.
import { assertCacheKey, assertCacheTtl, type Cache } from '@flussctrl/core'

export function kvCache (kv: KVNamespace): Cache {
  return {
    async get (key) {
      assertCacheKey(key)
      return (await kv.get(key, 'json')) ?? undefined
    },
    async put (key, value, { ttlSeconds }) {
      assertCacheKey(key)
      assertCacheTtl(ttlSeconds)
      if (value === undefined) throw new TypeError('cannot cache undefined; delete the key instead')
      await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds })
    },
    async delete (key) {
      assertCacheKey(key)
      await kv.delete(key)
    },
  }
}
