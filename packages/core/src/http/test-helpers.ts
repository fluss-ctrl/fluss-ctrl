// Test doubles for packages/core/http. Tests never touch the network.
import type { Resolver } from './resolver.ts'

/** Resolves names from a fixed table; unknown names have no records. */
export function staticResolver (table: Record<string, string[]>): Resolver & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async resolve (hostname) {
      calls.push(hostname)
      return table[hostname] ?? []
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
