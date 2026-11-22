// Contract tests (SPEC §11 item 2): the committed openapi.json is exactly what the routes generate,
// the Worker serves exactly the documented operations, and responses match the document.
import { env } from 'cloudflare:test'
import { ERROR_CODES, ID_SCHEMA_NAMES } from '@flussctrl/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import committedText from '../openapi.json?raw'
import { contractViolations, documentedOperations, type OpenApiDocument } from './contract.ts'
import { createApp } from './index.ts'
import { buildOpenApiDocument, openApiDocument, serialiseDocument } from './openapi.ts'

const goodEnv = { ...env, ENVIRONMENT: 'dev' }
const committed = JSON.parse(committedText) as OpenApiDocument

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openapi.json', () => {
  it('is what the routes generate, byte for byte (run `pnpm openapi` and commit if this fails)', () => {
    expect(serialiseDocument(buildOpenApiDocument())).toBe(committedText)
  })

  it('is what the Worker app itself generates', () => {
    expect(serialiseDocument(openApiDocument(createApp()))).toBe(committedText)
  })

  it('generates the same text every time', () => {
    expect(serialiseDocument(buildOpenApiDocument())).toBe(serialiseDocument(buildOpenApiDocument()))
  })

  it('documents every route the Worker serves, and nothing it does not', () => {
    const served = createApp().routes
      .filter((r) => r.method !== 'ALL')
      .map((r) => `${r.method} ${r.path.replaceAll(/:(\w+)/g, '{$1}')}`)
    expect([...new Set(served)].sort()).toEqual(documentedOperations(committed))
  })

  it('holds /health and the shared components only in Phase 0 (#13)', () => {
    expect(documentedOperations(committed)).toEqual(['GET /health'])
    const schemas = Object.keys(committed.components.schemas)
    expect(schemas).toEqual(expect.arrayContaining([...Object.values(ID_SCHEMA_NAMES), 'ErrorCode', 'ProblemDetails', 'NextCursor']))
    expect(Object.keys(committed.components.parameters).sort()).toEqual(['Cursor', 'Limit'])
    expect(committed.components.parameters.Limit).toMatchObject({ name: 'limit', in: 'query' })
    expect(committed.components.schemas.Limit).toMatchObject({ minimum: 1, maximum: 200, default: 50 })
  })

  it('lists every registered error code, so a new code reaches the document', () => {
    expect(committed.components.schemas.ErrorCode.enum).toEqual(Object.keys(ERROR_CODES))
  })

  it('has a shared response for each generic error, with its status in the description', () => {
    const responses = committed.components.responses as Record<string, { description: string }>
    expect(responses['NotFound']?.description).toContain('404 not_found')
    expect(responses['RateLimited']).toMatchObject({ headers: { 'Retry-After': { required: true } } })
  })
})

describe('contract: GET /health', () => {
  it('200 matches the document', async () => {
    const res = await createApp().request('/health', {}, goodEnv)
    expect(res.status).toBe(200)
    expect(await contractViolations(res, 'get', '/health')).toEqual([])
  })

  it('500 on a bad config matches the document', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await createApp().request('/health', {}, {})
    expect(res.status).toBe(500)
    expect(await contractViolations(res, 'get', '/health')).toEqual([])
  })
})

describe('contractViolations', () => {
  const ok = (body: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req_01934f6e-7b1a-7c3d-8e9f-0a1b2c3d4e5f', ...init.headers },
  })

  it('accepts a conforming response', async () => {
    expect(await contractViolations(ok({ status: 'ok' }), 'get', '/health')).toEqual([])
  })

  it('reports a body that breaks the schema', async () => {
    const problems = await contractViolations(ok({ status: 'degraded' }), 'get', '/health')
    expect(problems.join('\n')).toContain('body')
  })

  it('reports an undocumented status', async () => {
    expect(await contractViolations(ok({ status: 'ok' }, { status: 418 }), 'get', '/health')).toEqual(['GET /health does not document status 418'])
  })

  it('reports an undocumented operation', async () => {
    expect(await contractViolations(ok({}), 'post', '/health')).toEqual(['POST /health is not in openapi.json'])
  })

  it('reports a missing or malformed required header', async () => {
    const missing = new Response('{"status":"ok"}', { headers: { 'Content-Type': 'application/json' } })
    expect(await contractViolations(missing, 'get', '/health')).toEqual(['GET /health 200: missing required header X-Request-Id'])
    const malformed = ok({ status: 'ok' }, { headers: { 'X-Request-Id': 'nope' } })
    expect((await contractViolations(malformed, 'get', '/health')).join('\n')).toContain('header X-Request-Id')
  })

  it('reports the wrong media type and a non-JSON body', async () => {
    const text = new Response('ok', { headers: { 'Content-Type': 'text/plain', 'X-Request-Id': 'req_01934f6e-7b1a-7c3d-8e9f-0a1b2c3d4e5f' } })
    expect((await contractViolations(text, 'get', '/health')).join('\n')).toContain('media type text/plain')
    const broken = new Response('{', { headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req_01934f6e-7b1a-7c3d-8e9f-0a1b2c3d4e5f' } })
    expect(await contractViolations(broken, 'get', '/health')).toEqual(['GET /health 200: body is not JSON'])
  })

  it('prefers the exact status, then its range, then default (OpenAPI precedence)', async () => {
    const strict = { type: 'object', required: ['status'], properties: { status: { const: 'ok' } } }
    const loose = { 'application/json': {} }
    const doc = {
      paths: {
        '/r': {
          get: {
            responses: {
              '2XX': { description: 'range', content: { 'application/json': { schema: strict } } },
              default: { description: 'any', content: loose },
            },
          },
        },
        '/e': {
          get: {
            responses: {
              200: { description: 'exact', content: loose },
              '2XX': { description: 'range', content: { 'application/json': { schema: strict } } },
            },
          },
        },
      },
    } as unknown as OpenApiDocument
    const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    // 200 matches 2XX, not default, so the strict schema applies.
    expect((await contractViolations(json({ status: 'broken' }), 'get', '/r', doc)).join('\n')).toContain('body')
    expect(await contractViolations(json({ status: 'ok' }, 201), 'get', '/r', doc)).toEqual([])
    // A status outside the range falls back to default.
    expect(await contractViolations(json({ status: 'broken' }, 500), 'get', '/r', doc)).toEqual([])
    // An exact status wins over its range.
    expect(await contractViolations(json({ status: 'broken' }), 'get', '/e', doc)).toEqual([])
  })

  it('checks a problem body through the shared response $ref', async () => {
    const bad = new Response(JSON.stringify({ code: 'made_up' }), {
      status: 500,
      headers: { 'Content-Type': 'application/problem+json', 'X-Request-Id': 'req_01934f6e-7b1a-7c3d-8e9f-0a1b2c3d4e5f' },
    })
    expect((await contractViolations(bad, 'get', '/health')).join('\n')).toContain('body')
  })
})

describe('validation errors', () => {
  it('render as 422 validation_failed problem details', async () => {
    const { createRoute, z } = await import('@hono/zod-openapi')
    const app = createApp()
    app.openapi(createRoute({
      method: 'get',
      path: '/test/limit',
      request: { query: z.object({ limit: z.coerce.number().int().max(200) }) },
      responses: { 200: { description: 'ok' } },
    }), (c) => c.body(null, 200))
    const res = await app.request('/test/limit?limit=999', {}, goodEnv)
    expect(res.status).toBe(422)
    expect(res.headers.get('Content-Type')).toContain('application/problem+json')
    expect(await res.json()).toMatchObject({ code: 'validation_failed', detail: 'Invalid query.limit' })
  })
})
