import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ERROR_CODES, problemDetails, type ErrorCode } from '../errors.ts'
import { createIdGenerator, ID_PREFIXES, newId } from '../ids.ts'
import {
  ErrorCodeSchema, HealthSchema, ID_SCHEMA_NAMES, ID_SCHEMAS, listEnvelope, NextCursorSchema, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX,
  PaginationQuerySchema, ProblemDetailsSchema, RequestIdSchema,
} from './index.ts'

describe('id schemas', () => {
  it('accept every id the generator makes, for its own prefix only', () => {
    fc.assert(fc.property(
      fc.constantFrom(...ID_PREFIXES),
      fc.constantFrom(...ID_PREFIXES),
      fc.integer({ min: 0, max: 2 ** 48 - 1 }),
      (prefix, other, ms) => {
        const id = createIdGenerator({ now: () => ms })(prefix)
        expect(ID_SCHEMAS[prefix].safeParse(id).success).toBe(true)
        expect(ID_SCHEMAS[other].safeParse(id).success).toBe(prefix === other)
      }
    ))
  })

  it('reject malformed ids', () => {
    for (const bad of ['', 'dev_', 'dev_123', 'DEV_' + newId('dev').slice(4), newId('dev').toUpperCase(), `${newId('dev')} `, 42, null]) {
      expect(ID_SCHEMAS.dev.safeParse(bad).success).toBe(false)
    }
    // A UUIDv4 under the prefix is not a valid id.
    expect(ID_SCHEMAS.dev.safeParse('dev_0193f4a2-1b2c-4d3e-8f90-123456789abc').success).toBe(false)
  })

  it('carry their OpenAPI component name', () => {
    for (const prefix of ID_PREFIXES) {
      expect(ID_SCHEMAS[prefix].meta()?.id).toBe(ID_SCHEMA_NAMES[prefix])
    }
    expect(new Set(Object.values(ID_SCHEMA_NAMES)).size).toBe(ID_PREFIXES.length)
  })
})

describe('ProblemDetailsSchema', () => {
  it('accepts what problemDetails renders, for every code, with and without extensions', () => {
    for (const code of Object.keys(ERROR_CODES) as ErrorCode[]) {
      expect(ProblemDetailsSchema.safeParse(problemDetails(code, newId('req'))).success).toBe(true)
      const withExtras = problemDetails(code, newId('req'), { detail: 'why', extensions: { command_id: newId('cmd') } })
      expect(ProblemDetailsSchema.parse(withExtras)).toEqual(withExtras)
    }
  })

  it('rejects an unknown code, a bad request id or a non-error status', () => {
    const good = problemDetails('not_found', newId('req'))
    expect(ProblemDetailsSchema.safeParse({ ...good, code: 'made_up' }).success).toBe(false)
    expect(ProblemDetailsSchema.safeParse({ ...good, request_id: 'req_x' }).success).toBe(false)
    expect(ProblemDetailsSchema.safeParse({ ...good, status: 200 }).success).toBe(false)
  })

  it('takes its code list from the registry', () => {
    expect(ErrorCodeSchema.options).toEqual(Object.keys(ERROR_CODES))
  })
})

describe('pagination', () => {
  it('defaults the limit and leaves the cursor out on the first page', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ limit: PAGE_LIMIT_DEFAULT })
  })

  it('accepts a limit from 1 to the maximum, given as a query string', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: PAGE_LIMIT_MAX }), (n) => {
      expect(PaginationQuerySchema.parse({ limit: String(n), cursor: 'abc' })).toEqual({ limit: n, cursor: 'abc' })
    }))
  })

  it('rejects a limit outside 1 to the maximum, a fraction or an empty cursor', () => {
    for (const limit of ['0', String(PAGE_LIMIT_MAX + 1), '1.5', '-3', 'ten']) {
      expect(PaginationQuerySchema.safeParse({ limit }).success).toBe(false)
    }
    expect(PaginationQuerySchema.safeParse({ cursor: '' }).success).toBe(false)
  })

  it('wraps items in { data, next_cursor }', () => {
    const page = listEnvelope(z.object({ id: RequestIdSchema }))
    const id = newId('req')
    expect(page.parse({ data: [{ id }], next_cursor: null })).toEqual({ data: [{ id }], next_cursor: null })
    expect(page.safeParse({ data: [{ id }] }).success).toBe(false)
    expect(NextCursorSchema.parse('c2')).toBe('c2')
  })
})

describe('HealthSchema', () => {
  it('accepts only { status: "ok" }', () => {
    expect(HealthSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' })
    expect(HealthSchema.safeParse({ status: 'degraded' }).success).toBe(false)
  })
})
