// Test doubles for packages/core/http. Tests never touch the network.
import type { ResolvedAddress, Resolver } from './resolver.ts'

/**
 * Resolves names from a fixed table; unknown names have no records. An entry is either a list of
 * addresses (TTL 300) or a function of the call count, for answers that change between lookups.
 */
export function staticResolver (
  table: Record<string, string[] | ResolvedAddress[] | ((call: number) => ResolvedAddress[])>
): Resolver & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async resolve (hostname) {
      calls.push(hostname)
      const entry = table[hostname] ?? []
      const records = typeof entry === 'function' ? entry(calls.filter((h) => h === hostname).length) : entry
      return records.map((r) => (typeof r === 'string' ? { address: r, ttl: 300 } : r))
    },
  }
}

/** A fetch that never answers but rejects when its signal aborts, like the real one. */
export function hangingFetch (): (input: string, init?: RequestInit) => Promise<Response> {
  return (_input, init) => new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return }
    init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
  })
}
