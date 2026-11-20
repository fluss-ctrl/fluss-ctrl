import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createIdGenerator, ID_PREFIXES, idTimestamp, isId, newId, type IdPrefix } from './ids.ts'

describe('newId', () => {
  it('returns the prefix and a UUIDv7', () => {
    const id = newId('dev')
    expect(id).toMatch(/^dev_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(isId(id, 'dev')).toBe(true)
  })

  it('encodes the creation time', () => {
    const gen = createIdGenerator({ now: () => 1_763_640_000_123 })
    expect(idTimestamp(gen('cmd'))).toBe(1_763_640_000_123)
  })

  it('refuses an unknown prefix', () => {
    // The type already forbids it; this covers callers passing untyped input.
    expect(() => newId('nope' as IdPrefix)).toThrow(TypeError)
  })

  it('sorts ids generated in sequence in creation order (property)', () => {
    // Random clock steps, including repeats of the same millisecond and small steps backwards.
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 2 ** 47 }),
      fc.array(fc.integer({ min: -5, max: 5 }), { minLength: 2, maxLength: 300 }),
      fc.constantFrom(...ID_PREFIXES),
      (start, steps, prefix) => {
        let t = start
        const gen = createIdGenerator({ now: () => t })
        const ids: string[] = []
        for (const step of steps) {
          t = Math.max(0, t + step)
          ids.push(gen(prefix))
        }
        expect([...ids].sort()).toEqual(ids)
        expect(new Set(ids).size).toBe(ids.length)
      }
    ))
  })

  it('stays ordered when one millisecond overflows the sub-millisecond counter', () => {
    const gen = createIdGenerator({ now: () => 1000, randomBytes: (b) => { b.fill(0xff) } })
    const ids = Array.from({ length: 5000 }, () => gen('evt'))
    expect([...ids].sort()).toEqual(ids)
    expect(idTimestamp(ids.at(-1)!)).toBeGreaterThan(1000)
  })
})

describe('isId', () => {
  it('accepts any known prefix when none is given', () => {
    expect(isId(newId('org'))).toBe(true)
  })

  it.each([
    ['wrong prefix', () => isId(newId('org'), 'dev')],
    ['unknown prefix', () => isId('xyz_0193a3b4-0000-7000-8000-000000000000')],
    ['no separator', () => isId('dev0193a3b4')],
    ['not a v7 uuid', () => isId('dev_0193a3b4-0000-4000-8000-000000000000')],
    ['not a string', () => isId(42)],
  ])('rejects %s', (_name, check) => {
    expect(check()).toBe(false)
  })
})
