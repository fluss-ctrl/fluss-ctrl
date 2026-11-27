#!/usr/bin/env node
// Gradual rollout of the API Worker with automatic rollback (SPEC §16 "Environments", #10). Run
// only by .github/workflows/deploy.yml, never from a laptop or a session.
//
//   node scripts/deploy-worker.mjs --config <rendered config> --base-url <https://…> \
//     --canary <1-100> --message <text> [--full-deploy]
//   node scripts/deploy-worker.mjs --config <rendered config> --base-url <https://…> \
//     --restore <version id> --message <text>
//
// 1. Reads the current deployment. It must be one version at 100%; a split left by an earlier run
//    stops the deploy (resolve it by hand first, docs/runbooks/deploy.md).
// 2. Uploads the new version, sends it --canary percent of traffic and smoke-tests that exact
//    version (Cloudflare-Workers-Version-Overrides header). Then 100% and smoke again.
// 3. Any failed smoke puts the previous version back at 100% and exits non-zero.
//
// A smoke passes only when /health answers ok AND names the version under test, so an answer from
// the old version (a location the change has not reached yet) never counts.
//
// --restore deploys one existing version at 100% and smoke-tests it: the approved way out of a
// failed rollback or a stuck traffic split (docs/runbooks/deploy.md).
//
// `wrangler versions upload` cannot apply a Durable Object migration. The first deploy of a Worker,
// and a release that adds a migration (--full-deploy), use `wrangler deploy` (straight to 100%)
// instead; the runbook covers both.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

/** True when /health answered ok from the expected version (SPEC §4 Meta). */
export function healthy (status, body, expectedVersion) {
  return status === 200 && body !== null && typeof body === 'object' && body.status === 'ok' && body.version === expectedVersion
}

export function parseVersionId (value) {
  if (!VERSION_ID.test(value ?? '')) throw new Error('--restore must be a Worker version id (a UUID)')
  return value
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * GET <base>/health until it answers ok from `expectedVersion` or the attempts run out. A read;
 * retrying it is safe. Each attempt, body included, is bounded by `timeoutMs`, so a stalled request
 * counts as a failed attempt and a failing rollout still reaches its rollback.
 */
export async function smoke (baseUrl, expectedVersion, headers = {}, { attempts = 18, delayMs = 5000, timeoutMs = 10_000, fetchFn = fetch, wait = sleep } = {}) {
  const url = new URL('/health', baseUrl)
  let last = 'no response'
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchFn(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
      const body = await res.json().catch((err) => {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw err
        return null
      })
      if (healthy(res.status, body, expectedVersion)) return { ok: true, detail: `HTTP ${res.status} from ${expectedVersion} after ${i} attempt(s)` }
      last = res.status === 200 && body?.status === 'ok' ? `answered by version ${String(body.version ?? 'unknown')}` : `HTTP ${res.status}`
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
      restore: { type: 'string' },
    },
  })
  if (!values.config) throw new Error('--config is required')
  // Absolute, because Wrangler runs with apps/api as its working directory.
  const configPath = resolve(values.config)
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
    if (values.restore !== undefined) {
      const target = parseVersionId(values.restore)
      step(`Restoring ${target} at 100%`)
      wrangler(['versions', 'deploy', `${target}@100%`, '--yes', '--message', `restore: ${message}`.slice(0, 100)], opts)
      const result = await smoke(baseUrl, target, overrideHeader(workerName, target))
      if (!result.ok) {
        console.error(`::error::Smoke failed after restoring ${target}: ${result.detail}. Declare an incident (docs/runbooks/deploy.md).`)
        process.exit(1)
      }
      console.log(`Smoke passed: ${result.detail}. ${target} serves 100%.`)
      return
    }

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
      const result = await smoke(baseUrl, deployed)
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
      const result = await smoke(baseUrl, next, overrideHeader(workerName, next))
      if (!result.ok) {
        rollback(previous, `Canary smoke failed on ${next}: ${result.detail}`)
        process.exit(1)
      }
      console.log(`Canary smoke passed: ${result.detail}`)
    }

    step(`Promoting ${next} to 100%`)
    wrangler(['versions', 'deploy', `${next}@100%`, '--yes', '--message', message], opts)
    const result = await smoke(baseUrl, next, overrideHeader(workerName, next))
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
