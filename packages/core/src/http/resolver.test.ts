import { describe, expect, it } from 'vitest'
import { OutboundHttpError } from './errors.ts'
import { createDohResolver } from './resolver.ts'

const signal = new AbortController().signal

function dohFetch (byType: Record<string, unknown>, status = 200) {
  const urls: string[] = []
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    urls.push(input)
    expect(new Headers(init?.headers).get('accept')).toBe('application/dns-json')
    const type = new URL(input).searchParams.get('type') ?? ''
    return new Response(JSON.stringify(byType[type]), { status })
  }
  return { fetch, urls }
}

describe('createDohResolver', () => {
  it('returns A and AAAA addresses and skips CNAMEs', async () => {
    const { fetch, urls } = dohFetch({
      A: { Status: 0, Answer: [{ type: 5, data: 'edge.example.net.', TTL: 60 }, { type: 1, data: '93.184.216.34', TTL: 120 }] },
      AAAA: { Status: 0, Answer: [{ type: 28, data: '2606:2800:220:1::1', TTL: 45 }] },
    })
    const resolver = createDohResolver({ fetch, endpoint: 'https://doh.test/dns-query' })
    expect(await resolver.resolve('hooks.example.com', signal)).toEqual([{ address: '93.184.216.34', ttl: 60 }, { address: '2606:2800:220:1::1', ttl: 45 }])
    expect(urls[0]).toBe('https://doh.test/dns-query?name=hooks.example.com&type=A')
  })

  it('gives each address the shortest TTL in its alias chain', async () => {
    const { fetch } = dohFetch({
      A: { Status: 0, Answer: [{ type: 5, data: 'edge.example.net.', TTL: 1 }, { type: 1, data: '93.184.216.34', TTL: 300 }] },
      AAAA: { Status: 0, Answer: [{ type: 5, data: 'edge.example.net.', TTL: 60 }, { type: 28, data: '2606:2800:220:1::1', TTL: 300 }] },
    })
    expect(await createDohResolver({ fetch }).resolve('alias.example.com', signal))
      .toEqual([{ address: '93.184.216.34', ttl: 1 }, { address: '2606:2800:220:1::1', ttl: 60 }])
  })

  it('returns nothing for NXDOMAIN and for a name without answers', async () => {
    const { fetch } = dohFetch({ A: { Status: 3 }, AAAA: { Status: 0 } })
    expect(await createDohResolver({ fetch }).resolve('nope.example.com', signal)).toEqual([])
  })

  it.each([
    ['a SERVFAIL', { Status: 2 }, 200],
    ['an HTTP error', { Status: 0 }, 500],
    ['a malformed body', 'not json', 200],
    ['a malformed answer', { Status: 0, Answer: [{ type: '1', data: 1, TTL: 60 }] }, 200],
    ['an answer without a TTL', { Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }, 200],
    ['a non-array answer', { Status: 0, Answer: {} }, 200],
    ['a null answer entry', { Status: 0, Answer: [null] }, 200],
    ['a missing status', {}, 200],
  ])('fails closed on %s', async (_name, body, status) => {
    const { fetch } = dohFetch({ A: body, AAAA: body }, status)
    await expect(createDohResolver({ fetch }).resolve('x.example.com', signal)).rejects.toMatchObject({ code: 'dns_failed' })
  })

  it('reports a fetch failure as dns_failed', async () => {
    const fetch = async (): Promise<Response> => { throw new TypeError('connection refused') }
    await expect(createDohResolver({ fetch }).resolve('x.example.com', signal)).rejects.toBeInstanceOf(OutboundHttpError)
  })

  it('passes an abort through untouched', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch = async (): Promise<Response> => { throw new DOMException('aborted', 'AbortError') }
    await expect(createDohResolver({ fetch }).resolve('x.example.com', controller.signal)).rejects.toBeInstanceOf(DOMException)
  })
})
