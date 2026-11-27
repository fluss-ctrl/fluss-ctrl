#!/usr/bin/env node
// Stops a deploy whose Hyperdrive config has query caching on (SPEC §9, #10). Caching is a property
// of the Hyperdrive config, not of the Worker's binding, so the Wrangler config cannot express it;
// this asks the Cloudflare API instead. Hyperdrive caches reads by default and does not invalidate
// them on writes, so a revoked grant could read as valid: a missing setting counts as caching on.
//
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… HYPERDRIVE_ID=… node scripts/check-hyperdrive.mjs
//
// Prints the config's name and the verdict only; never the origin or any credential.
import { fileURLToPath } from 'node:url'

const ID = /^[0-9a-f]{32}$/

/** Returns why the API response fails the rule, or null when caching is disabled. */
export function cachingProblem (body) {
  if (body === null || typeof body !== 'object' || body.success !== true || typeof body.result !== 'object' || body.result === null) {
    const codes = Array.isArray(body?.errors) ? body.errors.map((e) => e?.code).filter((c) => c !== undefined) : []
    return `the Cloudflare API did not return the Hyperdrive config${codes.length ? ` (error ${codes.join(', ')})` : ''}`
  }
  if (body.result.caching?.disabled !== true) return `query caching is ON for Hyperdrive config "${body.result.name ?? body.result.id}"`
  return null
}

export function configUrl (accountId, hyperdriveId) {
  if (!ID.test(accountId ?? '')) throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character account id')
  if (!ID.test(hyperdriveId ?? '')) throw new Error('HYPERDRIVE_ID must be a 32-character Hyperdrive config id')
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/hyperdrive/configs/${hyperdriveId}`
}

async function main () {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId, HYPERDRIVE_ID: hyperdriveId } = process.env
  try {
    if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set')
    const res = await fetch(configUrl(accountId, hyperdriveId), { headers: { Authorization: `Bearer ${token}` } })
    const body = await res.json().catch(() => null)
    const problem = cachingProblem(body)
    if (problem) {
      console.error(`::error::${problem}. Disable it (docs/runbooks/deploy.md, "Hyperdrive") before deploying.`)
      process.exit(1)
    }
    console.log(`Hyperdrive config "${body.result.name}": query caching disabled.`)
  } catch (err) {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
