#!/usr/bin/env node
// Renders infra/wrangler/<env>.jsonc into apps/api/wrangler.<env>.generated.json for the deploy
// workflow (#10). `${NAME}` placeholders in string values are filled from environment variables of
// the same name (GitHub Environment variables in CI), and the result is refused if it breaks a rule
// that SPEC §9 puts on the API Worker. Comments are dropped from the output.
//
//   node scripts/render-wrangler-config.mjs staging
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const ENVIRONMENTS = ['staging', 'production']
export const PLACEMENT_REGION = 'aws:us-east-1'
export const HYPERDRIVE_BINDING = 'HYPERDRIVE'

const PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)\}/g
// Ids and names only: nothing that could break out of a JSON string or a shell argument.
const SAFE_VALUE = /^[A-Za-z0-9._:/-]+$/

/** Removes // and block comments outside strings, so JSONC parses with JSON.parse. */
export function stripJsonComments (text) {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i++
      } else if (ch === '"') {
        inString = false
      }
    } else if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) throw new Error('unterminated block comment')
      i = end + 1
    } else {
      out += ch
    }
  }
  return out
}

export function parseJsonc (text) {
  return JSON.parse(stripJsonComments(text))
}

/** Replaces ${NAME} in every string value. Throws listing every missing or unsafe variable. */
export function fillPlaceholders (config, env) {
  const problems = new Set()
  const fill = (value) => {
    if (typeof value === 'string') {
      return value.replace(PLACEHOLDER, (_, name) => {
        const v = env[name]
        if (v === undefined || v === '') {
          problems.add(`${name} is not set`)
          return ''
        }
        if (!SAFE_VALUE.test(v)) {
          problems.add(`${name} has characters an id cannot have`)
          return ''
        }
        return v
      })
    }
    if (Array.isArray(value)) return value.map(fill)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v)]))
    }
    return value
  }
  const filled = fill(config)
  if (problems.size > 0) throw new Error(`Cannot render the Wrangler config: ${[...problems].join('; ')}`)
  return filled
}

/** The SPEC §9 rules on the API Worker's config. Returns the broken ones; empty means fine. */
export function checkConfig (config, environment) {
  const issues = []
  if (config.placement?.region !== PLACEMENT_REGION || config.placement?.mode === 'smart') {
    issues.push(`placement.region must be "${PLACEMENT_REGION}" (SPEC §9), not Smart Placement`)
  }
  const hyperdrive = Array.isArray(config.hyperdrive) ? config.hyperdrive : []
  if (!hyperdrive.some((h) => h.binding === HYPERDRIVE_BINDING && typeof h.id === 'string' && h.id !== '')) {
    issues.push(`a "${HYPERDRIVE_BINDING}" Hyperdrive binding with an id is required`)
  }
  // Caching cannot be switched off per binding; a second binding to a cached config is the way a
  // cached read would sneak onto auth or grants. Only the one binding until SPEC §9's stale-safe
  // binding is designed.
  if (hyperdrive.length !== 1) issues.push('exactly one Hyperdrive binding is allowed (SPEC §9)')
  if (hyperdrive.some((h) => typeof h.localConnectionString === 'string')) {
    issues.push('a deployed config must not carry a localConnectionString')
  }
  if (config.version_metadata?.binding !== 'CF_VERSION_METADATA') {
    issues.push('a "CF_VERSION_METADATA" version_metadata binding is required (the deploy smoke test reads the version from /health)')
  }
  if (config.vars?.ENVIRONMENT !== environment) issues.push(`vars.ENVIRONMENT must be "${environment}"`)
  if (config.vars?.DO_LOCATION_HINT !== 'enam') issues.push('vars.DO_LOCATION_HINT must be "enam" (beside us-east-1, SPEC §9)')
  return issues
}

export function renderConfig (text, environment, env) {
  if (!ENVIRONMENTS.includes(environment)) throw new Error(`Unknown environment "${environment}"; expected ${ENVIRONMENTS.join(' or ')}`)
  const config = fillPlaceholders(parseJsonc(text), env)
  const issues = checkConfig(config, environment)
  if (issues.length > 0) throw new Error(`infra/wrangler/${environment}.jsonc breaks SPEC §9: ${issues.join('; ')}`)
  return config
}

function main () {
  const environment = process.argv[2]
  const root = fileURLToPath(new URL('..', import.meta.url))
  const source = `${root}infra/wrangler/${environment}.jsonc`
  const target = `${root}apps/api/wrangler.${environment}.generated.json`
  try {
    const config = renderConfig(readFileSync(source, 'utf8'), environment, process.env)
    writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`)
    console.log(`Wrote ${target}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
