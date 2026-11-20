import { z } from 'zod'

// Environment variables and bindings, validated with Zod before the Worker serves anything
// (SPEC §1). Add a key here before reading it anywhere else.
export const envSchema = z.object({
  ENVIRONMENT: z.enum(['dev', 'preview', 'staging', 'production']),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export type Env = z.infer<typeof envSchema>

export class ConfigError extends Error {
  readonly issues: readonly string[]

  constructor (issues: readonly string[]) {
    super(`Invalid Worker configuration: ${issues.join('; ')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

// Workers hand the same env object to every request in an isolate, so each one is parsed once.
const parsed = new WeakMap<object, Env>()

/**
 * Returns the validated config, or throws ConfigError naming the bad keys. Messages carry key
 * names and the reason only, never the values, so a misplaced secret cannot reach a log line.
 */
export function loadEnv (raw: unknown): Env {
  if (typeof raw !== 'object' || raw === null) throw new ConfigError(['env: missing'])
  const cached = parsed.get(raw)
  if (cached) return cached

  const result = envSchema.safeParse(raw)
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`))
  }
  parsed.set(raw, result.data)
  return result.data
}
