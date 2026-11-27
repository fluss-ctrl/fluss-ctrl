import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ENVIRONMENTS, PLACEMENT_REGION, checkConfig, fillPlaceholders, parseJsonc, renderConfig, stripJsonComments } from './render-wrangler-config.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
// `${NAME}` placeholders, built so the source holds no template-like literal strings.
const ph = (name) => '$' + '{' + name + '}'
const ids = { KV_CACHE_ID: 'a'.repeat(32), HYPERDRIVE_ID: 'b'.repeat(32) }

describe('stripJsonComments', () => {
  it('drops line and block comments but keeps comment-like text inside strings', () => {
    const text = '{\n  // line\n  "a": "http://x//y", /* block */ "b": "/* not */",\n  "c": "q\\"//"\n}'
    expect(JSON.parse(stripJsonComments(text))).toEqual({ a: 'http://x//y', b: '/* not */', c: 'q"//' })
  })

  it('rejects an unterminated block comment', () => {
    expect(() => stripJsonComments('{ /* open')).toThrow(/unterminated/)
  })

  it('leaves comment-free JSON unchanged in meaning', () => {
    fc.assert(fc.property(fc.jsonValue(), (value) => {
      const text = JSON.stringify(value)
      expect(JSON.parse(stripJsonComments(text))).toEqual(JSON.parse(text))
    }))
  })
})

describe('fillPlaceholders', () => {
  it('fills placeholders in nested string values and leaves other values alone', () => {
    const out = fillPlaceholders({ a: [{ id: ph('KV_CACHE_ID') }], n: 3, t: true, z: null, s: `x-${ph('HYPERDRIVE_ID')}` }, ids)
    expect(out).toEqual({ a: [{ id: ids.KV_CACHE_ID }], n: 3, t: true, z: null, s: `x-${ids.HYPERDRIVE_ID}` })
  })

  it('names every missing variable at once', () => {
    expect(() => fillPlaceholders({ a: ph('KV_CACHE_ID'), b: ph('HYPERDRIVE_ID') }, { KV_CACHE_ID: '' }))
      .toThrow(/KV_CACHE_ID is not set; HYPERDRIVE_ID is not set/)
  })

  it('refuses values that could break out of a string, without echoing them', () => {
    const run = () => fillPlaceholders({ a: ph('KV_CACHE_ID') }, { KV_CACHE_ID: 'x" , "evil": "1' })
    expect(run).toThrow(/KV_CACHE_ID has characters/)
    expect(run).not.toThrow(/evil/)
  })
})

describe('checkConfig', () => {
  const good = () => ({
    placement: { region: PLACEMENT_REGION },
    hyperdrive: [{ binding: 'HYPERDRIVE', id: 'b'.repeat(32) }],
    vars: { ENVIRONMENT: 'staging', DO_LOCATION_HINT: 'enam' },
  })

  it('accepts a config that follows SPEC §9', () => {
    expect(checkConfig(good(), 'staging')).toEqual([])
  })

  it.each([
    ['Smart Placement', (c) => { c.placement = { mode: 'smart' } }, /placement/],
    ['another region', (c) => { c.placement = { region: 'aws:eu-west-1' } }, /placement/],
    ['no Hyperdrive binding', (c) => { delete c.hyperdrive }, /Hyperdrive binding with an id/],
    ['a second Hyperdrive binding', (c) => { c.hyperdrive.push({ binding: 'HYPERDRIVE_CACHED', id: 'c'.repeat(32) }) }, /exactly one/],
    ['a local connection string', (c) => { c.hyperdrive[0].localConnectionString = 'postgres://x' }, /localConnectionString/],
    ['the wrong ENVIRONMENT', (c) => { c.vars.ENVIRONMENT = 'production' }, /ENVIRONMENT/],
    ['another location hint', (c) => { c.vars.DO_LOCATION_HINT = 'afr' }, /DO_LOCATION_HINT/],
  ])('refuses %s', (_, mutate, message) => {
    const config = good()
    mutate(config)
    expect(checkConfig(config, 'staging').join('\n')).toMatch(message)
  })
})

describe('infra/wrangler configs', () => {
  const dev = parseJsonc(read('apps/api/wrangler.jsonc'))

  it.each(ENVIRONMENTS)('%s renders and passes the SPEC §9 checks', (environment) => {
    const config = renderConfig(read(`infra/wrangler/${environment}.jsonc`), environment, ids)
    expect(config.placement).toEqual({ region: 'aws:us-east-1' })
    expect(config.hyperdrive).toEqual([{ binding: 'HYPERDRIVE', id: ids.HYPERDRIVE_ID }])
    expect(JSON.stringify(config)).not.toContain(ph(''))
  })

  it.each(ENVIRONMENTS)('%s keeps the Durable Object classes and migrations of the dev config', (environment) => {
    // A class's storage backend cannot change once deployed (ADR-0004), so every environment has to
    // declare the same classes and migration tags.
    const config = renderConfig(read(`infra/wrangler/${environment}.jsonc`), environment, ids)
    expect(config.durable_objects).toEqual(dev.durable_objects)
    expect(config.migrations).toEqual(dev.migrations)
    expect(config.compatibility_date).toBe(dev.compatibility_date)
  })

  it('serves production only on api.flussctrl.com and staging only on workers.dev', () => {
    const production = renderConfig(read('infra/wrangler/production.jsonc'), 'production', ids)
    const staging = renderConfig(read('infra/wrangler/staging.jsonc'), 'staging', ids)
    expect(production.workers_dev).toBe(false)
    expect(production.routes).toEqual([{ pattern: 'api.flussctrl.com', custom_domain: true }])
    expect(staging.workers_dev).toBe(true)
    expect(staging.routes).toBeUndefined()
  })

  it('refuses an unknown environment', () => {
    expect(() => renderConfig('{}', 'preview', ids)).toThrow(/Unknown environment/)
  })
})
