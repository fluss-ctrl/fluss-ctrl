#!/usr/bin/env node
// Writes the Wrangler config for one pull request's preview Worker (issue #9, SPEC §16
// "Environments"). It starts from apps/api/wrangler.jsonc, so bindings, Durable Object classes and
// their migrations cannot drift from what the tests run against, and changes only what a preview
// needs: its own Worker name, ENVIRONMENT=preview, and its own KV namespace.
//
// Each PR gets its own Worker (`fluss-ctrl-api-pr-<n>`) rather than a preview version of one shared
// Worker: Cloudflare does not give preview URLs to Workers that define Durable Objects, and a Worker
// per PR also keeps each PR's Durable Object storage apart. The preview workflow deletes the Worker,
// its KV namespace and its Neon branch when the PR closes.
//
// Run from CI only (.github/workflows/preview.yml), never from a session:
//   node scripts/preview-wrangler-config.mjs --pr <n> --kv-id <id> --out apps/api/wrangler.preview.json
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const devConfigPath = join(root, 'apps/api/wrangler.jsonc')

/** The Worker name for a PR's preview. Also used for its KV namespace and Neon branch. */
export function previewName (pr) {
  if (!/^[1-9]\d{0,8}$/.test(String(pr))) throw new Error(`--pr must be a pull request number, got ${JSON.stringify(pr)}`)
  return `fluss-ctrl-api-pr-${pr}`
}

/**
 * Derives a preview config from the dev config's raw object. Pure, so it is unit-tested.
 * `main` and `$schema` are rewritten relative to where the output file will live.
 * @param {Record<string, any>} raw the parsed apps/api/wrangler.jsonc
 * @param {{ pr: number | string, kvId: string, devDir: string, outDir: string }} opts
 */
export function previewConfig (raw, { pr, kvId, devDir, outDir }) {
  if (!/^[0-9a-f]{32}$/.test(kvId)) throw new Error('--kv-id must be a 32-character hex KV namespace id')
  const kv = raw.kv_namespaces ?? []
  if (kv.length !== 1 || kv[0].binding !== 'CACHE') {
    // A new KV binding needs its own namespace per PR: add it to the workflow before it ships.
    throw new Error('expected exactly one KV namespace (CACHE) in apps/api/wrangler.jsonc; update the preview workflow for new ones')
  }
  const fromOut = (p) => relative(outDir, resolve(devDir, p)).split('\\').join('/')
  const { $schema, ...rest } = raw
  return {
    ...rest,
    name: previewName(pr),
    main: fromOut(raw.main),
    workers_dev: true,
    preview_urls: false,
    vars: { ...raw.vars, ENVIRONMENT: 'preview' },
    kv_namespaces: [{ binding: 'CACHE', id: kvId }],
  }
}

async function main () {
  const { values } = parseArgs({
    options: {
      pr: { type: 'string' },
      'kv-id': { type: 'string' },
      out: { type: 'string' },
    },
  })
  if (!values.pr || !values['kv-id'] || !values.out) {
    throw new Error('usage: preview-wrangler-config.mjs --pr <n> --kv-id <id> --out <file>')
  }
  // Wrangler is a dependency of apps/api, not of the root, so resolve it from there.
  const require = createRequire(join(root, 'apps/api/package.json'))
  const { experimental_readRawConfig: readRawConfig } = await import(pathToFileURL(require.resolve('wrangler')).href)
  const { rawConfig } = readRawConfig({ config: devConfigPath })
  const out = resolve(values.out)
  const config = previewConfig(rawConfig, { pr: values.pr, kvId: values['kv-id'], devDir: dirname(devConfigPath), outDir: dirname(out) })
  writeFileSync(out, JSON.stringify(config, null, 2) + '\n')
  console.log(`Wrote ${relative(root, out)} for ${config.name}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
