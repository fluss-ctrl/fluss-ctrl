import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { previewConfig, previewName } from './preview-wrangler-config.mjs'

const kvId = '0123456789abcdef0123456789abcdef'

const raw = {
  $schema: '../../node_modules/wrangler/config-schema.json',
  name: 'fluss-ctrl-api-dev',
  main: 'src/index.ts',
  compatibility_date: '2026-11-01',
  vars: { ENVIRONMENT: 'dev', DO_LOCATION_HINT: 'enam' },
  durable_objects: { bindings: [{ name: 'DEVICE_COORDINATOR', class_name: 'DeviceCoordinator' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['DeviceCoordinator'] }],
  kv_namespaces: [{ binding: 'CACHE', id: 'fluss-ctrl-dev-cache' }],
}

const opts = { pr: 42, kvId, devDir: '/repo/apps/api', outDir: '/repo/apps/api' }

describe('previewName', () => {
  it('names the Worker after the PR', () => {
    expect(previewName(42)).toBe('fluss-ctrl-api-pr-42')
    expect(previewName('7')).toBe('fluss-ctrl-api-pr-7')
  })

  it('refuses anything that is not a PR number', () => {
    for (const bad of ['', '0', '-1', '1.5', '42; rm -rf /', '1e3', '012', 'abc', undefined]) {
      expect(() => previewName(bad)).toThrow(/pull request number/)
    }
  })

  it('always yields a valid Worker name (lowercase, at most 63 characters)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 999_999_999 }), (n) => {
      expect(previewName(n)).toMatch(/^[a-z0-9-]{1,63}$/)
    }))
  })
})

describe('previewConfig', () => {
  it('changes only the name, environment, KV namespace and URLs', () => {
    const config = previewConfig(raw, opts)
    expect(config).toEqual({
      name: 'fluss-ctrl-api-pr-42',
      main: 'src/index.ts',
      compatibility_date: '2026-11-01',
      workers_dev: true,
      preview_urls: false,
      vars: { ENVIRONMENT: 'preview', DO_LOCATION_HINT: 'enam' },
      durable_objects: raw.durable_objects,
      migrations: raw.migrations,
      kv_namespaces: [{ binding: 'CACHE', id: kvId }],
    })
  })

  it('does not change the dev config it was given', () => {
    const copy = structuredClone(raw)
    previewConfig(raw, opts)
    expect(raw).toEqual(copy)
  })

  it('rewrites main relative to the output file', () => {
    expect(previewConfig(raw, { ...opts, outDir: '/repo/tmp' }).main).toBe('../apps/api/src/index.ts')
  })

  it('refuses a KV id that is not one', () => {
    expect(() => previewConfig(raw, { ...opts, kvId: 'fluss-ctrl-dev-cache' })).toThrow(/kv-id/)
  })

  it('refuses a config whose KV bindings the workflow does not provision', () => {
    const extra = { ...raw, kv_namespaces: [...raw.kv_namespaces, { binding: 'OTHER', id: 'x' }] }
    expect(() => previewConfig(extra, opts)).toThrow(/exactly one KV namespace/)
  })
})

describe('the real apps/api/wrangler.jsonc', () => {
  it('produces a preview config through the CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'preview-config-'))
    try {
      const out = join(dir, 'wrangler.preview.json')
      execFileSync(process.execPath, [fileURLToPath(new URL('./preview-wrangler-config.mjs', import.meta.url)), '--pr', '9', '--kv-id', kvId, '--out', out], { stdio: 'pipe' })
      const config = JSON.parse(readFileSync(out, 'utf8'))
      expect(config.name).toBe('fluss-ctrl-api-pr-9')
      expect(config.vars.ENVIRONMENT).toBe('preview')
      expect(config.kv_namespaces).toEqual([{ binding: 'CACHE', id: kvId }])
      expect(config.durable_objects.bindings.map((b) => b.name)).toEqual(['DEVICE_COORDINATOR', 'RATE_LIMITER'])
      expect(config.main).toMatch(/apps\/api\/src\/index\.ts$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
