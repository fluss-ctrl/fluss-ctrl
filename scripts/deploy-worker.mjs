#!/usr/bin/env node
// Gradual rollout of the API Worker with automatic rollback (SPEC §16 "Environments", #10). Run
// only by .github/workflows/deploy.yml, never from a laptop or a session.
//
//   node scripts/deploy-worker.mjs --config <rendered config> --base-url <https://…> \
//     --canary <1-100> --message <text> [--full-deploy]
//
// 1. Reads the current deployment. It must be one version at 100%; a split left by an earlier run
//    stops the deploy (resolve it by hand first, docs/runbooks/deploy.md).
// 2. Uploads the new version, sends it --canary percent of traffic and smoke-tests that exact
//    version (Cloudflare-Workers-Version-Overrides header). Then 100% and smoke again.
// 3. Any failed smoke puts the previous version back at 100% and exits non-zero.
//
// `wrangler versions upload` cannot apply a Durable Object migration. The first deploy of a Worker,
// and a release that adds a migration (--full-deploy), use `wrangler deploy` (straight to 100%)
// instead; the runbook covers both.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The version id from Wrangler's ND-JSON output file (WRANGLER_OUTPUT_FILE_PATH). */
export function versionIdFromOutput (ndjson, type) {
  const ids = ndjson.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
    .filter((e) => e.type === type && typeof e.version_id === 'string').map((e) => e.version_id)
  const id = ids.at(-1)
  if (!id || !VERSION_ID.test(id)) throw new Error(`Wrangler reported no version id for "${type}"`)
  return id
}

/** The version serving all traffic, from `wrangler deployments status --json`. */
export function soleVersion (deployment) {
  const versions = Array.isArray(deployment?.versions) ? deployment.versions : []
  if (versions.length !== 1 || versions[0].percentage !== 100 || !VERSION_ID.test(versions[0].version_id ?? '')) {
    const split = versions.map((v) => `${v.version_id}@${v.percentage}%`).join(', ') || 'none'
    throw new Error(`The current deployment is not one version at 100% (${split}). Resolve it by hand before deploying (docs/runbooks/deploy.md).`)
  }
  return versions[0].version_id
}

/** True when `wrangler deployments status` failed because the Worker has never been deployed. */
export function isFirstDeploy (stderr) {
  return /has no deployments|\[code: 10007\]|workers\.api\.error\.script_not_found/i.test(stderr)
}

export function parseCanary (value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('--canary must be an integer from 1 to 100')
  return n
}

export function overrideHeader (workerName, versionId) {
  return { 'Cloudflare-Workers-Version-Overrides': `${workerName}="${versionId}"` }
}

/** True when the /health response is the Worker's liveness answer (SPEC §4 Meta). */
export function healthy (status, body) {
  return status === 200 && body !== null && typeof body === 'object' && body.status === 'ok'
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** GET <base>/health until it passes or the attempts run out. A read; retrying it is safe. */
export async function smoke (baseUrl, headers = {}, { attempts = 12, delayMs = 5000, fetchFn = fetch, wait = sleep } = {}) {
  const url = new URL('/health', baseUrl)
  let last = 'no response'
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchFn(url, { headers, redirect: 'manual' })
      const body = await res.json().catch(() => null)
      if (healthy(res.status, body)) return { ok: true, detail: `HTTP ${res.status} after ${i} attempt(s)` }
      last = `HTTP ${res.status}`
    } catch (err) {
      last = err instanceof Error ? err.name : 'error'
    }
    if (i < attempts) await wait(delayMs)
  }
  return { ok: false, detail: `${last} after ${attempts} attempts` }
}

function wrangler (args, { configPath, outputFile } = {}) {
  const bin = fileURLToPath(new URL('../apps/api/node_modules/.bin/wrangler', import.meta.url))
  return execFileSync(bin, [...args, '--config', configPath], {
    cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(outputFile ? { WRANGLER_OUTPUT_FILE_PATH: outputFile } : {}) },
  })
}

function step (text) {
  console.log(`\n▶ ${text}`)
}

async function main () {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      'base-url': { type: 'string' },
      canary: { type: 'string', default: '10' },
      message: { type: 'string', default: '' },
      'full-deploy': { type: 'boolean', default: false },
    },
  })
  const configPath = values.config
  if (!configPath) throw new Error('--config is required')
  const baseUrl = new URL(values['base-url'] ?? '')
  if (baseUrl.protocol !== 'https:') throw new Error('--base-url must be https')
  const canary = parseCanary(values.canary)
  const message = values.message.slice(0, 100)
  const workerName = JSON.parse(readFileSync(configPath, 'utf8')).name

  const dir = mkdtempSync(join(tmpdir(), 'wrangler-out-'))
  const outputFile = join(dir, 'output.ndjson')
  const opts = { configPath, outputFile }
  const rollback = (previous, reason) => {
    console.error(`::error::${reason}`)
    if (!previous) {
      console.error('::error::No previous version to roll back to. The Worker stays as deployed; follow docs/runbooks/deploy.md.')
      return
    }
    step(`Rolling back: ${previous} at 100%`)
    wrangler(['versions', 'deploy', `${previous}@100%`, '--yes', '--message', `rollback: ${message}`.slice(0, 100)], opts)
    console.error(`Rolled back to ${previous}.`)
  }

  try {
    step('Reading the current deployment')
    let previous = null
    try {
      previous = soleVersion(JSON.parse(wrangler(['deployments', 'status', '--json'], opts)))
      console.log(`Serving now: ${previous}`)
    } catch (err) {
      const stderr = String(err?.stderr ?? '')
      if (!isFirstDeploy(stderr)) throw err.stderr ? new Error(stderr.trim()) : err
      console.log('No deployment yet: first deploy.')
    }

    if (previous === null || values['full-deploy']) {
      step('wrangler deploy (100%; applies Durable Object migrations)')
      wrangler(['deploy', '--message', message], opts)
      const deployed = versionIdFromOutput(readFileSync(outputFile, 'utf8'), 'deploy')
      console.log(`Deployed ${deployed}`)
      const result = await smoke(baseUrl)
      if (!result.ok) {
        rollback(previous, `Smoke failed on ${deployed}: ${result.detail}`)
        process.exit(1)
      }
      console.log(`Smoke passed: ${result.detail}`)
      return
    }

    step('Uploading the new version')
    wrangler(['versions', 'upload', '--message', message], opts)
    const next = versionIdFromOutput(readFileSync(outputFile, 'utf8'), 'version-upload')
    console.log(`Uploaded ${next}`)

    if (canary < 100) {
      step(`Canary: ${next} at ${canary}%, ${previous} at ${100 - canary}%`)
      wrangler(['versions', 'deploy', `${next}@${canary}%`, `${previous}@${100 - canary}%`, '--yes', '--message', `canary: ${message}`.slice(0, 100)], opts)
      const result = await smoke(baseUrl, overrideHeader(workerName, next))
      if (!result.ok) {
        rollback(previous, `Canary smoke failed on ${next}: ${result.detail}`)
        process.exit(1)
      }
      console.log(`Canary smoke passed: ${result.detail}`)
    }

    step(`Promoting ${next} to 100%`)
    wrangler(['versions', 'deploy', `${next}@100%`, '--yes', '--message', message], opts)
    const result = await smoke(baseUrl, overrideHeader(workerName, next))
    if (!result.ok) {
      rollback(previous, `Smoke after promotion failed on ${next}: ${result.detail}`)
      process.exit(1)
    }
    console.log(`Smoke passed: ${result.detail}. ${next} serves 100%.`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (err) {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
